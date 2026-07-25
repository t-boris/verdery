/**
 * The media half of garden and account purge (P8-DELETE-01) — section 10.7's
 * "media, derivatives" and section 11's "Deletes or transfers media according
 * to garden ownership".
 *
 * WHY THIS LIVES IN THE MEDIA MODULE AND NOT IN `deletion`: deleting media
 * bytes already has one implementation — section 16 of media-storage-and-
 * processing.md, built by P6-RET-01 and driven from three initiators
 * (`DeleteGardenMedia`, `RunMediaRetentionSweep`,
 * `RecordMediaProcessingResult`). A purge is a fourth initiator, not a fourth
 * mechanism: it schedules deletion through the very same
 * `scheduleMediaDeletionWorkflow`, so the bytes are removed prefix-scoped by
 * the worker's own storage identity, their absence is VERIFIED by re-listing
 * the prefix, and only then does the record reach `deleted`. The purge waits
 * for that verification rather than assuming it.
 *
 * WHY SCHEDULING AND DRAINING ARE SEPARATE CALLS: byte deletion is
 * asynchronous and crosses a process boundary. `execute` starts it for every
 * record in scope; `countUndeleted` is the gate the purge re-checks on later
 * sweep passes. Between them the purge does nothing else to the subject, so a
 * media deletion that fails keeps the structured rows alive and visible
 * instead of leaving orphaned bytes behind a deleted database row — the exact
 * failure section 16 warns about ("User-visible deletion remains pending
 * until required objects are confirmed deleted").
 *
 * Each candidate is scheduled in its own transaction, the retention sweep's
 * own posture: one failure never poisons the rest of the batch.
 */

import type { Clock } from '../../../shared/time/clock.js';
import type { MediaPurgeScope } from './media-repository.js';
import { scheduleMediaDeletionWorkflow } from './media-deletion-workflow.js';
import type { MediaDeletionInitiator } from './media-deletion-workflow.js';
import type { MediaStorageBucketNames } from './media-storage-target.js';
import type { MediaUnitOfWork } from './media-unit-of-work.js';

/**
 * Per-pass ceiling. Deliberately larger than the retention sweep's 25: that
 * sweep trickles through routine expiry, while a purge has a subject waiting
 * on it and every candidate is guaranteed to need scheduling. A garden with
 * more media than this simply finishes over a few sweep passes, which the
 * drain gate already makes safe.
 */
export const PURGE_MEDIA_BATCH_LIMIT = 200;

export interface SchedulePurgeMediaDeletionResult {
  /** Records whose byte deletion this pass handed to the worker (or completed in place, for a record that never reached storage). */
  readonly scheduled: number;
  /** Candidates skipped after losing a concurrent revision race — the next pass picks them up. */
  readonly lostRaces: number;
}

export class SchedulePurgeMediaDeletion {
  constructor(
    private readonly unitOfWork: MediaUnitOfWork,
    private readonly buckets: MediaStorageBucketNames,
    private readonly clock: Clock,
  ) {}

  async execute(
    scope: MediaPurgeScope,
    initiator: MediaDeletionInitiator,
  ): Promise<SchedulePurgeMediaDeletionResult> {
    const candidates = await this.unitOfWork.run((context) =>
      context.media.listPurgeCandidates(scope, PURGE_MEDIA_BATCH_LIMIT),
    );

    let scheduled = 0;
    let lostRaces = 0;

    for (const candidate of candidates) {
      const outcome = await this.unitOfWork.run(async (context) => {
        const record = await context.media.get(candidate.id);
        if (
          record === null ||
          record.uploadState === 'deletion_scheduled' ||
          record.uploadState === 'deleted'
        ) {
          return 'gone' as const;
        }

        const result = await scheduleMediaDeletionWorkflow(
          context,
          record,
          this.buckets.derived,
          initiator,
          this.clock.now(),
        );
        return result.kind === 'lost_race' ? ('lost_race' as const) : ('scheduled' as const);
      });

      if (outcome === 'scheduled') scheduled += 1;
      else if (outcome === 'lost_race') lostRaces += 1;
    }

    return { scheduled, lostRaces };
  }

  /**
   * The drain gate: how many of the scope's media records have not yet
   * reached `deleted`. Zero means every byte the workflow was responsible for
   * is confirmed absent and the structured rows may go.
   */
  countUndeleted(scope: MediaPurgeScope): Promise<number> {
    return this.unitOfWork.run((context) => context.media.countUndeletedForPurge(scope));
  }
}
