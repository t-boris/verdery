/**
 * `RunDeletionSweep` (P8-DELETE-01): one bounded pass that claims every
 * subject whose 30-day recovery window has closed and drives every purge
 * already in flight — architecture/data-export-and-deletion.md section 11's
 * "After the deadline, an idempotent workflow".
 *
 * WHERE THIS RUNS, AND WHY: in `services/api`, triggered by an authenticated
 * internal endpoint the worker's interval scheduler calls — the identical
 * split all four existing sweeps document. Running the purge in
 * `services/workers` would mean granting `verdery_worker` DELETE on every
 * module's tables, which is the single widest privilege grant this codebase
 * could make, to save one HTTP hop. The worker contributes the tick and its
 * OIDC identity; every privileged delete stays here.
 *
 * CLAIMING IS THE POINT OF NO RETURN, and it is a transition, not a
 * comparison. A subject is claimed by moving it to `purging`/`disabled` in
 * the same transaction that inserts its deletion record — after which
 * `restoreGarden`/`restoreAccount` refuse it. A user racing the sweep loses
 * or wins by whichever transaction commits first; nobody's recovery is
 * decided by two processes reading a clock.
 *
 * A GARDEN'S MEMBERS ARE REVOKED AT CLAIM TIME, in that same transaction:
 * section 10.6's "Emits revocation changes for offline clients" at the moment
 * the garden genuinely stops being recoverable. Whoever the deletion REQUEST
 * already revoked is untouched — they converged 30 days ago.
 *
 * RESUME BEFORE CLAIM, deliberately: unfinished purges are driven first, so a
 * backlog of deferred purges cannot be starved by a steady arrival of new
 * ones. Each subject is claimed and purged independently; one failure is
 * counted and never poisons the rest of the batch (the relay's own posture).
 */

import { isUniqueViolation } from '../../../platform/database/postgres-errors.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { claimGardenForPurge, revokeGardenMemberships } from '../../gardens-mapping/public.js';
import { claimAccountForPurge } from '../../identity-access/public.js';
import { claimPurge, deferPurge } from '../domain/deletion-record.js';
import type { DeletionRecord } from '../domain/deletion-record.js';
import type { DeletionUnitOfWork } from './deletion-unit-of-work.js';
import type { RunPurge } from './run-purge.js';

/**
 * Per-run ceilings. No document names a number. A purge is far heavier than a
 * retention-sweep candidate and the deadline it enforces is day-granular, so
 * small batches on an hourly tick drain any realistic backlog with room to
 * spare while bounding one tick's work — the same "no number decided yet,
 * pick one and say so" posture `RETENTION_SWEEP_BATCH_LIMIT` documents.
 */
export const DELETION_CLAIM_BATCH_LIMIT = 10;
export const DELETION_RESUME_BATCH_LIMIT = 10;

/** Stamped on a purge whose pass threw — a fixed marker, never the error text. */
export const PURGE_FAILED_REASON = 'purge_failed';

export interface DeletionSweepResult {
  readonly gardensClaimed: number;
  readonly accountsClaimed: number;
  readonly purgesCompleted: number;
  /** Purges that stopped short this pass (media bytes not yet confirmed absent) and will resume on the next tick. */
  readonly purgesDeferred: number;
  /** Purges that threw. Counted, logged by the route, and retried next tick — never silently dropped. */
  readonly purgesFailed: number;
  /** Claims that lost a race with a concurrent sweep pass. */
  readonly lostClaims: number;
}

export class RunDeletionSweep {
  constructor(
    private readonly unitOfWork: DeletionUnitOfWork,
    private readonly runPurge: RunPurge,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<DeletionSweepResult> {
    let gardensClaimed = 0;
    let accountsClaimed = 0;
    let lostClaims = 0;

    const unfinished = await this.unitOfWork.run((context) =>
      context.deletionRecords.listUnfinished(DELETION_RESUME_BATCH_LIMIT),
    );
    const pending: DeletionRecord[] = [...unfinished];

    const now = this.clock.now();

    for (const garden of await this.unitOfWork.run((context) =>
      context.gardens.listDeletionDue(now, DELETION_CLAIM_BATCH_LIMIT),
    )) {
      const claimed = await this.claimGarden(garden.id);
      if (claimed === null) lostClaims += 1;
      else {
        gardensClaimed += 1;
        pending.push(claimed);
      }
    }

    for (const profile of await this.unitOfWork.run((context) =>
      context.profiles.listDeletionDue(now, DELETION_CLAIM_BATCH_LIMIT),
    )) {
      const claimed = await this.claimAccount(profile.id);
      if (claimed === null) lostClaims += 1;
      else {
        accountsClaimed += 1;
        pending.push(claimed);
      }
    }

    let purgesCompleted = 0;
    let purgesDeferred = 0;
    let purgesFailed = 0;

    for (const record of pending) {
      try {
        const outcome = await this.runPurge.execute(record);
        if (outcome === 'purged') purgesCompleted += 1;
        else purgesDeferred += 1;
      } catch {
        // Section 16: "Partial provider failure remains internally visible
        // and retries." The record stays `purging` with its checkpoints, so
        // the next tick resumes exactly where this one stopped; the failure
        // itself is stamped on the record so an operator can see WHICH purge
        // is stuck without reading logs, and the sweep's own counter carries
        // it to the worker's structured log line.
        //
        // The reason is a fixed marker, not the error's message: a database
        // error text can quote a value from a row being deleted, and this
        // row must never become a copy of the data it certifies gone
        // (section 19).
        purgesFailed += 1;
        await this.markFailed(record);
      }
    }

    return {
      gardensClaimed,
      accountsClaimed,
      purgesCompleted,
      purgesDeferred,
      purgesFailed,
      lostClaims,
    };
  }

  /** Stamps `purge_failed` on a record whose pass threw, best-effort: if even this write fails the next tick still retries the purge itself. */
  private async markFailed(record: DeletionRecord): Promise<void> {
    try {
      await this.unitOfWork.run(async (context) => {
        const current = await context.deletionRecords.findBySubject(
          record.subjectType,
          record.subjectId,
        );
        if (current === null || current.state !== 'purging') {
          return;
        }
        await context.deletionRecords.update(
          deferPurge(current, PURGE_FAILED_REASON, this.clock.now()),
          current.revision,
        );
      });
    } catch {
      // Deliberately swallowed: this is diagnostic bookkeeping, and failing
      // to record why a purge failed must not also stop the sweep from
      // finishing its remaining subjects.
    }
  }

  /** One transaction: the lifecycle claim, the revocation cascade, the deletion record, and the audit event. */
  private claimGarden(gardenId: string): Promise<DeletionRecord | null> {
    return this.claim(async (context) => {
      const garden = await context.gardens.findById(gardenId);
      if (garden === null || garden.lifecycleState !== 'deletion_requested') {
        return null;
      }
      // Non-null: the migration's own linkage CHECK pairs this state with a
      // deadline, and `listDeletionDue` selected on it.
      const recoveryDeadlineAt = garden.recoveryDeadlineAt as Date;

      const now = this.clock.now();
      const claimed = claimGardenForPurge(garden, now);
      if (!(await context.gardens.update(claimed, garden.revision))) {
        return null;
      }

      await revokeGardenMemberships(context, claimed, null, now);

      const record = claimPurge(
        {
          id: generateUuidV7(),
          subjectType: 'garden',
          subjectId: garden.id,
          requestedByProfileId: garden.createdByProfileId,
          requestedAt: garden.deletionRequestedAt ?? recoveryDeadlineAt,
          recoveryDeadlineAt,
        },
        now,
      );
      await context.deletionRecords.insert(record);

      await context.auditLogger.record({
        eventType: 'garden.purge_started',
        subjectType: 'garden',
        subjectId: garden.id,
        actorProfileId: null,
        actorType: 'system',
        details: { recoveryDeadlineAt: recoveryDeadlineAt.toISOString() },
      });

      return record;
    });
  }

  private claimAccount(profileId: string): Promise<DeletionRecord | null> {
    return this.claim(async (context) => {
      const profile = await context.profiles.findById(profileId);
      if (profile === null || profile.accountState !== 'deletion_requested') {
        return null;
      }
      const recoveryDeadlineAt = profile.recoveryDeadlineAt as Date;

      const now = this.clock.now();
      const claimed = claimAccountForPurge(profile, now);
      if (!(await context.profiles.update(claimed, profile.revision))) {
        return null;
      }

      const record = claimPurge(
        {
          id: generateUuidV7(),
          subjectType: 'account',
          subjectId: profile.id,
          requestedByProfileId: profile.id,
          requestedAt: profile.deletionRequestedAt ?? recoveryDeadlineAt,
          recoveryDeadlineAt,
        },
        now,
      );
      await context.deletionRecords.insert(record);

      await context.auditLogger.record({
        eventType: 'account.purge_started',
        subjectType: 'profile',
        subjectId: profile.id,
        actorProfileId: null,
        actorType: 'system',
        details: { recoveryDeadlineAt: recoveryDeadlineAt.toISOString() },
      });

      return record;
    });
  }

  /**
   * Runs one claim transaction, treating the `(subject_type, subject_id)`
   * unique violation as "another pass claimed it first" rather than an error:
   * that index exists precisely to decide this race, and the loser has
   * nothing to do.
   */
  private async claim(
    work: (
      context: Parameters<Parameters<DeletionUnitOfWork['run']>[0]>[0],
    ) => Promise<DeletionRecord | null>,
  ): Promise<DeletionRecord | null> {
    try {
      return await this.unitOfWork.run(work);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return null;
      }
      throw error;
    }
  }
}
