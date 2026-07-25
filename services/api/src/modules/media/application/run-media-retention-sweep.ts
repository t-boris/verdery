/**
 * `RunMediaRetentionSweep` (P6-RET-01): one bounded pass over the two
 * candidate sets section 15 defines duration-based reconciliation for —
 * `available` originals whose `retention_deadline_at` has passed, and
 * pre-`available` registrations stale past the orphan-reconciliation
 * window (`domain/media-retention.ts`) — each scheduled into the ordinary
 * deletion workflow (`media-deletion-workflow.ts`).
 *
 * WHERE THIS RUNS, AND WHY: in `services/api`, triggered by an
 * authenticated internal endpoint the worker's own interval scheduler
 * calls (`services/workers/src/retention/`). The alternative — the sweep
 * query running inside `services/workers` — would require granting
 * `verdery_worker` SELECT on `media.media_record`, a table that role has
 * deliberately never been able to read (1785200000000_media-processing-
 * jobs.sql's own grant reasoning), AND a write path for the transitions,
 * which must stay privileged API writes under the established P6-WORKER-01
 * trust boundary. Triggering instead of querying keeps the worker's
 * database footprint exactly as narrow as it is today: the worker
 * contributes only its poll loop (this codebase's one established home for
 * periodic work — no Cloud Scheduler convention exists yet) and its
 * already-established OIDC identity; every media read and every privileged
 * write stays in this process.
 *
 * Each candidate is processed in its own transaction, so one failure never
 * poisons the rest of the batch (the relay's own per-event posture), and a
 * candidate that lost a revision race is skipped — the next sweep, or the
 * concurrent winner, owns it.
 *
 * A retention-expired record still referenced by an attachment row is
 * SKIPPED and counted, not force-deleted: section 15's own "Lifecycle
 * deletion must not race an active retry, support case, or legal hold"
 * counsels conservatism, and a referenced record is by definition still in
 * use. Today this is a theoretical set (only `export_package` rows carry
 * deadlines and nothing attaches those), but the guard is the same one
 * `DeleteGardenMedia` enforces, applied consistently.
 */

import type { Clock } from '../../../shared/time/clock.js';
import { staleUploadCutoff } from '../domain/media-retention.js';
import type { MediaRecord } from '../domain/media-record.js';
import { scheduleMediaDeletionWorkflow } from './media-deletion-workflow.js';
import type { MediaDeletionInitiator } from './media-deletion-workflow.js';
import type { MediaStorageBucketNames } from './media-storage-target.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';

/**
 * Per-run candidate ceiling per category. No document names a number; 25
 * bounds one sweep's work (each candidate is its own transaction and may
 * fan out to thousands of derivative-row updates for a plan) while
 * draining any realistic backlog within a few hourly runs — the same
 * "no number decided yet, pick one and say so" posture
 * `RELAY_BATCH_SIZE`'s own comment established.
 */
export const RETENTION_SWEEP_BATCH_LIMIT = 25;

export interface MediaRetentionSweepResult {
  /** Retention-deadline records whose deletion this run scheduled. */
  readonly retentionScheduled: number;
  /** Retention-deadline records skipped because attachment rows still reference them. */
  readonly retentionSkippedReferenced: number;
  /** Stale pre-`available` records this run scheduled (or, for never-authorized rows with no object, completed immediately). */
  readonly staleScheduled: number;
  /** Candidates skipped after losing a concurrent revision race. */
  readonly lostRaces: number;
}

const SYSTEM_RETENTION_INITIATOR: MediaDeletionInitiator = {
  actorProfileId: null,
  actorType: 'system',
  reason: 'retention_deadline',
};

const SYSTEM_STALE_INITIATOR: MediaDeletionInitiator = {
  actorProfileId: null,
  actorType: 'system',
  reason: 'stale_upload',
};

export class RunMediaRetentionSweep {
  constructor(
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly buckets: MediaStorageBucketNames,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<MediaRetentionSweepResult> {
    const now = this.clock.now();

    const retentionCandidates = await this.listCandidates((context) =>
      context.media.listRetentionExpired(now, RETENTION_SWEEP_BATCH_LIMIT),
    );
    const staleCandidates = await this.listCandidates((context) =>
      context.media.listStaleUploads(staleUploadCutoff(now), RETENTION_SWEEP_BATCH_LIMIT),
    );

    let retentionScheduled = 0;
    let retentionSkippedReferenced = 0;
    let staleScheduled = 0;
    let lostRaces = 0;

    for (const candidate of retentionCandidates) {
      const outcome = await this.scheduleOne(candidate.id, SYSTEM_RETENTION_INITIATOR, true);
      if (outcome === 'scheduled') retentionScheduled += 1;
      else if (outcome === 'referenced') retentionSkippedReferenced += 1;
      else if (outcome === 'lost_race') lostRaces += 1;
    }

    for (const candidate of staleCandidates) {
      const outcome = await this.scheduleOne(candidate.id, SYSTEM_STALE_INITIATOR, false);
      if (outcome === 'scheduled') staleScheduled += 1;
      else if (outcome === 'lost_race') lostRaces += 1;
    }

    return { retentionScheduled, retentionSkippedReferenced, staleScheduled, lostRaces };
  }

  /** Candidate ids are listed in a short read transaction of their own; each candidate is then re-read and processed in its own transaction. */
  private listCandidates(
    list: (
      context: Parameters<Parameters<MediaUnitOfWork['run']>[0]>[0],
    ) => Promise<readonly MediaRecord[]>,
  ): Promise<readonly MediaRecord[]> {
    return this.unitOfWork.run(list);
  }

  private async scheduleOne(
    mediaId: string,
    initiator: MediaDeletionInitiator,
    checkReferences: boolean,
  ): Promise<'scheduled' | 'referenced' | 'lost_race' | 'gone'> {
    try {
      return await this.unitOfWork.run(async (context) => {
        const record = await context.media.get(mediaId);
        if (
          record === null ||
          record.uploadState === 'deletion_scheduled' ||
          record.uploadState === 'deleted' ||
          record.uploadState === 'rejected'
        ) {
          // Already handled (or resolved) between listing and processing.
          return 'gone';
        }

        const now = this.clock.now();
        const outcome = await scheduleMediaDeletionWorkflow(
          context,
          record,
          this.buckets.derived,
          initiator,
          now,
        );
        if (outcome.kind === 'lost_race') {
          return 'lost_race';
        }

        if (checkReferences) {
          // AFTER the row update, the same lock-ordering
          // `DeleteGardenMedia` uses (see media-deletion-workflow.ts's own
          // comment) — throwing rolls this candidate's whole transaction
          // back, leaving the referenced record untouched for a later
          // sweep once it is detached.
          const referenceKinds = await context.references.findReferenceKinds(record.id);
          if (referenceKinds.length > 0) {
            throw new SweepCandidateReferencedError();
          }
        }

        return 'scheduled';
      });
    } catch (error) {
      if (error instanceof SweepCandidateReferencedError) {
        return 'referenced';
      }
      throw error;
    }
  }
}

/** Internal rollback sentinel — never surfaces past `scheduleOne`. */
class SweepCandidateReferencedError extends Error {
  constructor() {
    super('Sweep candidate is still referenced; its transaction was rolled back.');
    this.name = 'SweepCandidateReferencedError';
  }
}
