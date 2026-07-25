/**
 * Executes ONE claimed purge, resumably (P8-DELETE-01) — architecture/
 * data-export-and-deletion.md sections 10.5-10.9 and 11.
 *
 * THE SHAPE OF A PURGE, and why it is this shape:
 *
 * ```text
 * (already claimed: subject is `purging`/`disabled`, deletion record exists)
 *        │
 *        ├─ 1. hand every media record to the byte-deletion workflow
 *        ├─ 2. GATE: are all those records `deleted` (bytes confirmed absent)?
 *        │       no ──▶ defer; the next sweep pass resumes here
 *        ├─ 3. preparations (release the one reference cycle, close live jobs)
 *        ├─ 4. the ordered delete steps, each its own transaction + checkpoint
 *        ├─ 5. account only: delete the identity provider's user
 *        ├─ 6. account only: minimize the profile row to a tombstone
 *        └─ 7. complete — the record becomes the surviving evidence
 * ```
 *
 * IDEMPOTENT AND RESUMABLE AT EVERY LINE. A crash anywhere re-enters at the
 * top on the next sweep pass and is safe because each phase is individually
 * convergent, not because the whole thing is transactional (it deliberately
 * is not — see below):
 *
 * - Phase 1 skips records already in the deletion pipeline.
 * - Phase 2 is a pure read, and is the reason the whole purge can wait
 *   without holding anything.
 * - Phase 4's steps each delete "rows matching a predicate", so re-running a
 *   completed one deletes zero; the checkpoint is an optimization that also
 *   happens to be the evidence. Because a step's deletes and its checkpoint
 *   commit together, the evidence can never describe work that did not
 *   happen.
 * - Phase 5's port contract requires an already-absent user to be success.
 * - Phases 6 and 7 are both no-ops when already applied.
 *
 * WHY NOT ONE BIG TRANSACTION: a purge waits on another PROCESS (the worker
 * deleting bytes), so it cannot be one transaction even in principle. Given
 * that, per-step transactions are strictly better than one long one: the
 * longest lock any purge holds is one step of one subject, and progress
 * survives a crash instead of being rolled back.
 *
 * WHY THE MEDIA GATE COMES FIRST: deleting the `media_record` rows before the
 * bytes are confirmed gone would leave orphaned objects in a bucket with
 * nothing left in the database pointing at them — undeletable, unauditable,
 * and exactly the outcome section 16 of media-storage-and-processing.md
 * refuses ("User-visible deletion remains pending until required objects are
 * confirmed deleted"). Waiting costs a sweep interval; not waiting costs
 * unrecoverable residue.
 */

import type { IdentityProviderAccountGateway } from '../../../platform/authentication/identity-provider-account-gateway.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { MediaDeletionInitiator, SchedulePurgeMediaDeletion } from '../../media/public.js';
import type { MediaPurgeScope } from '../../media/public.js';
import { markAccountPurged } from '../../identity-access/public.js';
import type { DeletionRecord } from '../domain/deletion-record.js';
import {
  beginPurgeAttempt,
  completePurge,
  deferPurge,
  recordIdentityProviderDeletion,
  recordScheduledMediaDeletions,
} from '../domain/deletion-record.js';
import type { DeletionUnitOfWork } from './deletion-unit-of-work.js';
import {
  ACCOUNT_PURGE_PREPARATIONS,
  ACCOUNT_PURGE_STEPS,
  GARDEN_PURGE_PREPARATIONS,
  GARDEN_PURGE_STEPS,
} from './purge-plan.js';
import type { PurgePreparation, PurgeStep } from './purge-plan.js';

/**
 * Rows per `DELETE` statement inside one step. No document names a number.
 * Ten thousand is large enough that an ordinary garden finishes every step in
 * one statement, and small enough that the biggest realistic set — a mature
 * garden's revision journals — never becomes one enormous locked write.
 */
export const PURGE_DELETE_BATCH_SIZE = 10_000;

/** The one legitimate reason a purge stops short today: bytes not yet confirmed absent. */
export const DEFERRED_ON_MEDIA = 'media_deletion_pending';

export type PurgeOutcome = 'purged' | 'deferred';

const GARDEN_MEDIA_INITIATOR: MediaDeletionInitiator = {
  actorProfileId: null,
  actorType: 'system',
  reason: 'garden_purge',
};

const ACCOUNT_MEDIA_INITIATOR: MediaDeletionInitiator = {
  actorProfileId: null,
  actorType: 'system',
  reason: 'account_purge',
};

export class RunPurge {
  constructor(
    private readonly unitOfWork: DeletionUnitOfWork,
    private readonly purgeMedia: SchedulePurgeMediaDeletion,
    private readonly identityProvider: IdentityProviderAccountGateway,
    private readonly clock: Clock,
  ) {}

  async execute(claimed: DeletionRecord): Promise<PurgeOutcome> {
    const record = await this.mutate(claimed, (current, now) => beginPurgeAttempt(current, now));

    const scope: MediaPurgeScope =
      record.subjectType === 'garden'
        ? { kind: 'garden', gardenId: record.subjectId }
        : { kind: 'accountPackages', profileId: record.subjectId };

    // Phase 1.
    const scheduling = await this.purgeMedia.execute(
      scope,
      record.subjectType === 'garden' ? GARDEN_MEDIA_INITIATOR : ACCOUNT_MEDIA_INITIATOR,
    );
    let current =
      scheduling.scheduled === 0
        ? record
        : await this.mutate(record, (value, now) =>
            recordScheduledMediaDeletions(value, scheduling.scheduled, now),
          );

    // Phase 2 — the gate.
    if ((await this.purgeMedia.countUndeleted(scope)) > 0) {
      await this.mutate(current, (value, now) => deferPurge(value, DEFERRED_ON_MEDIA, now));
      return 'deferred';
    }

    // Phases 3 and 4.
    const preparations =
      record.subjectType === 'garden' ? GARDEN_PURGE_PREPARATIONS : ACCOUNT_PURGE_PREPARATIONS;
    const steps = record.subjectType === 'garden' ? GARDEN_PURGE_STEPS : ACCOUNT_PURGE_STEPS;

    const completed = new Set(
      (
        await this.unitOfWork.run((context) => context.deletionRecords.listCheckpoints(current.id))
      ).map((checkpoint) => checkpoint.stepName),
    );

    await this.runPreparations(preparations, current, completed);
    await this.runSteps(steps, current, completed);

    // Phases 5 and 6 — the identity half, accounts only.
    if (record.subjectType === 'account') {
      current = await this.purgeIdentity(current);
    }

    // Phase 7. The completion audit event for an ACCOUNT was already written
    // alongside its tombstone above (that is where "purged" actually becomes
    // true for a profile); a garden's is written here, because a garden's
    // last step is the disappearance of its own row.
    const finished = await this.mutate(current, (value, now) => completePurge(value, now));

    if (record.subjectType === 'garden') {
      await this.unitOfWork.run((context) =>
        context.auditLogger.record({
          eventType: 'garden.purged',
          subjectType: 'garden',
          subjectId: finished.subjectId,
          actorProfileId: null,
          actorType: 'system',
          // Section 19: verifiable without retaining deleted content. A
          // deadline, an attempt count, and how many media records went —
          // no names, no rows, no object keys.
          details: {
            recoveryDeadlineAt: finished.recoveryDeadlineAt.toISOString(),
            attemptCount: finished.attemptCount,
            mediaRecordsScheduled: finished.mediaRecordsScheduled,
          },
        }),
      );
    }

    return 'purged';
  }

  private async runPreparations(
    preparations: readonly PurgePreparation[],
    record: DeletionRecord,
    completed: ReadonlySet<string>,
  ): Promise<void> {
    for (const preparation of preparations) {
      if (completed.has(preparation.name)) {
        continue;
      }
      await this.unitOfWork.run(async (context) => {
        const touched = await context.purge.prepare(preparation, record.subjectId);
        await context.deletionRecords.recordCheckpoint(record.id, {
          stepName: preparation.name,
          rowsDeleted: touched,
          completedAt: this.clock.now(),
        });
      });
    }
  }

  private async runSteps(
    steps: readonly PurgeStep[],
    record: DeletionRecord,
    completed: ReadonlySet<string>,
  ): Promise<void> {
    for (const batch of groupConsecutiveSteps(steps)) {
      const pending = batch.filter((step) => !completed.has(step.name));
      if (pending.length === 0) {
        continue;
      }

      // One transaction per group. A group of one — every step but the
      // deferred-constraint pair — is exactly the per-step transaction this
      // always was; a larger group is a set of tables the schema only allows
      // to be emptied together. See `PurgeStep.group`.
      await this.unitOfWork.run(async (context) => {
        for (const step of pending) {
          const deleted = await context.purge.deleteAll(
            step,
            record.subjectId,
            PURGE_DELETE_BATCH_SIZE,
          );
          await context.deletionRecords.recordCheckpoint(record.id, {
            stepName: step.name,
            rowsDeleted: deleted,
            completedAt: this.clock.now(),
          });
        }
      });
    }
  }

  /**
   * Section 11's "Deletes Firebase Authentication identity after application
   * preconditions", then the profile tombstone.
   *
   * STRICTLY IN THIS ORDER. The provider call needs the real `firebaseUid`,
   * which the tombstone destroys, so scrubbing first would strand a live
   * identity nothing could ever find again. And if the provider call fails,
   * the profile stays `disabled` — unusable, still purgeable — rather than
   * `purged` with a signable credential still outstanding.
   */
  private async purgeIdentity(record: DeletionRecord): Promise<DeletionRecord> {
    const profile = await this.unitOfWork.run((context) =>
      context.profiles.findById(record.subjectId),
    );

    if (profile === null || profile.accountState === 'purged') {
      // Already finished by an earlier attempt.
      return record;
    }

    await this.identityProvider.deleteUser(profile.firebaseUid);
    const withIdentity = await this.mutate(record, (value, now) =>
      recordIdentityProviderDeletion(value, now),
    );

    await this.unitOfWork.run(async (context) => {
      const now = this.clock.now();
      const purged = markAccountPurged(profile, now);
      await context.profiles.update(purged, profile.revision);
      await context.auditLogger.record({
        eventType: 'account.purged',
        subjectType: 'profile',
        subjectId: purged.id,
        actorProfileId: null,
        actorType: 'system',
        details: { identityProviderDeleted: true },
      });
    });

    return withIdentity;
  }

  /** Re-reads the record inside a transaction and applies one domain transition, revision-guarded. */
  private async mutate(
    record: DeletionRecord,
    transition: (current: DeletionRecord, now: Date) => DeletionRecord,
  ): Promise<DeletionRecord> {
    return this.unitOfWork.run(async (context) => {
      const current = await context.deletionRecords.findBySubject(
        record.subjectType,
        record.subjectId,
      );
      if (current === null) {
        return record;
      }

      const next = transition(current, this.clock.now());
      if (next === current) {
        return current;
      }

      await context.deletionRecords.update(next, current.revision);
      return next;
    });
  }
}

/**
 * Splits the plan into transaction units: consecutive steps sharing a
 * `group` become one unit, every ungrouped step its own. A group whose steps
 * are not adjacent would silently split here, which is why the plan documents
 * that they must be consecutive.
 */
function groupConsecutiveSteps(steps: readonly PurgeStep[]): PurgeStep[][] {
  const units: PurgeStep[][] = [];

  for (const step of steps) {
    const previous = units.at(-1);
    if (step.group !== undefined && previous !== undefined && previous[0]?.group === step.group) {
      previous.push(step);
      continue;
    }
    units.push([step]);
  }

  return units;
}
