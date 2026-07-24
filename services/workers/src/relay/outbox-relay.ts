/**
 * The transactional outbox relay for media-processing jobs (P6-ASYNC-01).
 *
 * Scans `platform.outbox_event` for unpublished `media.processing_requested`
 * rows (appended by `@verdery/api`'s `CompleteMediaUpload` — see that
 * command's own header comment for why THIS event, at THIS trigger point),
 * and for each one: creates a durable `media.processing_job` row, enqueues a
 * Cloud Tasks task carrying that job's manifest, and marks the outbox row
 * published. Lives in `services/workers`, not `services/api` — this
 * package's own doc comment already anticipates "scheduled processing ...
 * registered here as they are implemented" (architecture/backend-modular-
 * monolith.md section "19. Worker Boundary"), and `main.ts` drives this
 * class on a plain `setInterval` loop rather than an HTTP-triggered
 * endpoint, since no existing scheduling convention (Cloud Scheduler ->
 * HTTP handler) exists yet in this codebase to reuse and a bare interval is
 * the simplest correct implementation of "poll periodically."
 *
 * CRASH-RECOVERY SEQUENCING, PER EVENT:
 *
 *   1. `processingJobs.ensureRequested({id: event.id, ...})` — idempotent:
 *      returns the EXISTING row if one is already there (from a previous,
 *      possibly-crashed tick), or inserts a fresh `requested` row keyed by
 *      the event's own id.
 *   2. If the job is still `requested` (never successfully queued):
 *      `mediaProcessingQueue.enqueue(...)`, called OUTSIDE any database
 *      transaction — architecture/backend-modular-monolith.md section
 *      "12. Transactions": "Transactions are short and never contain ...
 *      external provider calls." Cloud Tasks' own deterministic task-name
 *      deduplication (see `cloud-tasks-media-processing-queue.ts`) makes a
 *      repeated `enqueue` call for the same job safe even if this exact
 *      step is what a previous tick crashed after.
 *   3. `processingJobs.markQueued(job.id, now)` — only after step 2
 *      actually succeeded.
 *   4. `outboxEvents.markPublished(event.id, now)` — LAST, matching
 *      architecture/asynchronous-processing.md section "4. Transactional
 *      Outbox": "Publishes to the intended Pub/Sub topic or task creation
 *      adapter. Records publication result idempotently." Publish first,
 *      record second.
 *
 * If a tick crashes between steps 1-4 for one event, the NEXT tick's own
 * `ensureRequested` call for that same event id finds the already-`queued`
 * (or later) job, skips step 2/3 entirely, and proceeds straight to step 4 —
 * closing the gap without ever re-enqueueing. This is this stage's own
 * concrete answer to "Duplicate delivery and relay crash tests"
 * (implementation-plan.md work package P6-ASYNC-01's own completion
 * evidence column).
 *
 * One event's failure (a thrown error at any step) is caught, logged, and
 * does not stop the rest of the batch — matching architecture/asynchronous-
 * processing.md section "12. Retry Classification": a transient failure on
 * one event is retried on the NEXT tick (the outbox row stays unpublished),
 * never a poison-message loop that jams every other pending event.
 *
 * Source: implementation-plan.md work package P6-ASYNC-01;
 * architecture/asynchronous-processing.md, sections "4. Transactional
 * Outbox", "5. Cloud Tasks", "11. Idempotency", "12. Retry Classification".
 */

import type {
  MediaProcessingManifest,
  MediaProcessingRequestedEventPayload,
} from '@verdery/api-contracts';
import type { Logger } from '../logger.js';
import type { OutboxEventRecord, OutboxEventStore } from './outbox-event-store.js';
import type { MediaProcessingQueue } from './media-processing-queue.js';
import type { ProcessingJobStore } from './processing-job-store.js';

const DEFAULT_PROCESSOR_CONFIG_VERSION = 'v1';

export interface Clock {
  now(): Date;
}

export interface OutboxRelayDependencies {
  readonly outboxEvents: OutboxEventStore;
  readonly processingJobs: ProcessingJobStore;
  readonly mediaProcessingQueue: MediaProcessingQueue;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly batchSize: number;
}

export interface RelayTickResult {
  readonly claimed: number;
  readonly enqueued: number;
  readonly alreadyQueued: number;
  readonly failed: number;
}

function buildManifest(
  job: { readonly id: string; readonly mediaId: string; readonly processorConfigVersion: string },
  payload: MediaProcessingRequestedEventPayload,
  traceId: string | null,
): MediaProcessingManifest {
  return {
    jobId: job.id,
    mediaId: job.mediaId,
    processorConfigVersion: job.processorConfigVersion,
    inputObjects: [{ bucketName: payload.bucketName, objectKey: payload.objectKey }],
    expectedChecksums: payload.checksumSha256 === null ? [] : [payload.checksumSha256],
    validation: {
      mediaClass: payload.mediaClass,
      displayFilename: payload.displayFilename,
      expectedContentType: payload.contentType,
      expectedByteSize: payload.byteSize,
    },
    ...(traceId === null ? {} : { traceId }),
  };
}

export class OutboxRelay {
  constructor(private readonly deps: OutboxRelayDependencies) {}

  /** Runs one scan-claim-enqueue-publish pass. Never throws: per-event failures are caught and counted. */
  async tick(): Promise<RelayTickResult> {
    const events = await this.deps.outboxEvents.claimUnpublished(this.deps.batchSize);

    let enqueued = 0;
    let alreadyQueued = 0;
    let failed = 0;

    for (const event of events) {
      try {
        const wasEnqueued = await this.processOne(event);
        if (wasEnqueued) {
          enqueued += 1;
        } else {
          alreadyQueued += 1;
        }
      } catch (error) {
        failed += 1;
        this.deps.logger.error(
          { err: error, event: 'relay.event_failed', outboxEventId: event.id },
          'Failed to process an outbox event; it remains unpublished and will be retried next tick',
        );
      }
    }

    return { claimed: events.length, enqueued, alreadyQueued, failed };
  }

  /** Returns `true` when this call actually enqueued a Cloud Tasks task, `false` when the job was already past `requested` (crash-recovery replay). */
  private async processOne(event: OutboxEventRecord): Promise<boolean> {
    const payload = event.payload as MediaProcessingRequestedEventPayload;
    const now = this.deps.clock.now();

    const job = await this.deps.processingJobs.ensureRequested(
      {
        id: event.id,
        mediaId: payload.mediaId,
        processorConfigVersion: DEFAULT_PROCESSOR_CONFIG_VERSION,
        inputChecksums: payload.checksumSha256 === null ? [] : [payload.checksumSha256],
        traceId: event.traceId,
      },
      now,
    );

    let wasEnqueued = false;
    if (job.state === 'requested') {
      const manifest = buildManifest(job, payload, event.traceId);
      await this.deps.mediaProcessingQueue.enqueue({ taskName: job.id, manifest });
      await this.deps.processingJobs.markQueued(job.id, now);
      wasEnqueued = true;
    }

    await this.deps.outboxEvents.markPublished(event.id, now);
    return wasEnqueued;
  }
}
