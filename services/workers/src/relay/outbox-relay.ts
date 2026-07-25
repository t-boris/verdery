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
 * P6-WORKER-02 extends this relay with a SECOND recognized event type,
 * `MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE` (appended by
 * `services/api`'s `RecordMediaProcessingResult` on a successful
 * `media_validation` result for a raster-eligible media class — see that
 * file's own header comment). `jobKindForEventType` below maps an event's
 * own `eventType` to the `job_kind` the job created for it should carry;
 * everything else in this file's own crash-recovery/idempotency machinery
 * is unchanged and applies identically to both event types — the same
 * `ensureRequested`/`enqueue`/`markQueued`/`markPublished` sequence, just
 * parameterized by `jobKind` now instead of a single hardcoded value.
 *
 * P7-NOTIF-01 adds a second FAMILY, not a fourth job kind:
 * `recommendation.candidate_created` events are FORWARDED whole to
 * `services/api`'s internal notification-policy endpoint (see
 * `notification-event-dispatcher.ts` for the privilege-boundary reasoning)
 * instead of becoming media-processing jobs. The crash-recovery shape is
 * the same publish-first/record-second sequence with one step fewer: the
 * API endpoint is duplicate-safe per event (per-recipient deduplication
 * keys), so `dispatch` then `markPublished` needs no durable job row in
 * between — a crash between the two re-delivers next tick and the API
 * converges to zero new intents.
 *
 * Source: implementation-plan.md work packages P6-ASYNC-01, P6-WORKER-02,
 * P7-NOTIF-01; architecture/asynchronous-processing.md, sections
 * "4. Transactional Outbox", "5. Cloud Tasks", "11. Idempotency",
 * "12. Retry Classification"; architecture/notifications.md, section
 * "5. Flow".
 */

import {
  EXPORT_COMPLETED_EVENT_TYPE,
  EXPORT_GENERATION_JOB_KIND,
  EXPORT_REQUESTED_EVENT_TYPE,
  MEDIA_DELETION_REQUESTED_EVENT_TYPE,
  MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
  RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
  type ExportGenerationManifest,
  type ExportRequestedEventPayload,
  type MediaDeletionRequestedEventPayload,
  type MediaProcessingManifest,
  type MediaProcessingRequestedEventPayload,
} from '@verdery/api-contracts';
import {
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  MEDIA_VALIDATION_JOB_KIND,
} from '../job-kind.js';
import type { Logger } from '../logger.js';
import type { NotificationEventDispatcher } from './notification-event-dispatcher.js';
import type { OutboxEventRecord, OutboxEventStore } from './outbox-event-store.js';
import type { MediaProcessingQueue } from './media-processing-queue.js';
import type { ProcessingJobStore } from './processing-job-store.js';

const DEFAULT_PROCESSOR_CONFIG_VERSION = 'v1';

/** See this file's own header comment. */
function jobKindForEventType(eventType: string): string {
  switch (eventType) {
    case MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE:
      return MEDIA_DERIVATIVE_GENERATION_JOB_KIND;
    case MEDIA_DELETION_REQUESTED_EVENT_TYPE:
      return MEDIA_DELETION_JOB_KIND;
    default:
      return MEDIA_VALIDATION_JOB_KIND;
  }
}

export interface Clock {
  now(): Date;
}

export interface OutboxRelayDependencies {
  readonly outboxEvents: OutboxEventStore;
  readonly processingJobs: ProcessingJobStore;
  readonly mediaProcessingQueue: MediaProcessingQueue;
  /** P7-NOTIF-01: forwards `recommendation.candidate_created` events to the API's notification policy — see this file's header. */
  readonly notificationEvents: NotificationEventDispatcher;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly batchSize: number;
}

export interface RelayTickResult {
  readonly claimed: number;
  readonly enqueued: number;
  readonly alreadyQueued: number;
  /** Notification-relevant events forwarded to — and durably processed by — the API this tick (P7-NOTIF-01). */
  readonly notificationsDispatched: number;
  readonly failed: number;
  /**
   * Age of the OLDEST event this tick claimed, measured `occurred_at` -> now
   * at claim time — the relay-side outbox-publication-lag signal
   * (architecture/asynchronous-processing.md section "18. Observability";
   * P6-OBS-01). Healthy steady state stays within one or two poll intervals
   * (`RELAY_POLL_INTERVAL_MS`, 5s default); a growing value means the relay
   * is falling behind (repeated per-event failures, a starved process, or a
   * Cloud Tasks outage). `null` when the tick claimed nothing — an idle
   * relay has no lag to report, and `poller.ts` does not log idle ticks.
   */
  readonly oldestClaimedEventAgeMs: number | null;
}

function buildManifest(
  job: { readonly id: string; readonly mediaId: string; readonly processorConfigVersion: string },
  payload: MediaProcessingRequestedEventPayload,
  traceId: string | null,
  jobKind: string,
): MediaProcessingManifest {
  // A `media.deletion_requested` payload is the processing payload plus
  // `objectPrefixes` (see the contract type's own doc comment); the
  // manifest carries them through as its optional `deletion` block, and
  // everything else stays the shared shape both other kinds already use.
  const deletionPayload =
    jobKind === MEDIA_DELETION_JOB_KIND ? (payload as MediaDeletionRequestedEventPayload) : null;

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
    jobKind,
    ...(traceId === null ? {} : { traceId }),
    ...(deletionPayload === null
      ? {}
      : { deletion: { objectPrefixes: deletionPayload.objectPrefixes } }),
  };
}

export class OutboxRelay {
  constructor(private readonly deps: OutboxRelayDependencies) {}

  /** Runs one scan-claim-enqueue-publish pass. Never throws: per-event failures are caught and counted. */
  async tick(): Promise<RelayTickResult> {
    const events = await this.deps.outboxEvents.claimUnpublished(this.deps.batchSize);

    // Computed over the whole claimed batch rather than trusting the
    // store's oldest-first ordering — one `Math.min` keeps the figure
    // correct even against a store that returns rows unordered. Clamped at
    // zero: a fixed test clock earlier than a row's `occurred_at` must not
    // report a negative lag.
    const oldestClaimedEventAgeMs =
      events.length === 0
        ? null
        : Math.max(
            0,
            this.deps.clock.now().getTime() -
              Math.min(...events.map((event) => event.occurredAt.getTime())),
          );

    let enqueued = 0;
    let alreadyQueued = 0;
    let notificationsDispatched = 0;
    let failed = 0;

    for (const event of events) {
      try {
        if (
          event.eventType === RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE ||
          event.eventType === EXPORT_COMPLETED_EVENT_TYPE
        ) {
          // Both are FORWARD-family events: the API's notification-policy
          // endpoint is duplicate-safe per event, so dispatch-then-record
          // needs no durable job row — see this file's header (P7-NOTIF-01)
          // and P8-EXPORT-01's own export_ready intent.
          await this.dispatchNotificationEvent(event);
          notificationsDispatched += 1;
        } else if (event.eventType === EXPORT_REQUESTED_EVENT_TYPE) {
          await this.enqueueExportGeneration(event);
          enqueued += 1;
        } else {
          const wasEnqueued = await this.processOne(event);
          if (wasEnqueued) {
            enqueued += 1;
          } else {
            alreadyQueued += 1;
          }
        }
      } catch (error) {
        failed += 1;
        this.deps.logger.error(
          { err: error, event: 'relay.event_failed', outboxEventId: event.id },
          'Failed to process an outbox event; it remains unpublished and will be retried next tick',
        );
      }
    }

    return {
      claimed: events.length,
      enqueued,
      alreadyQueued,
      notificationsDispatched,
      failed,
      oldestClaimedEventAgeMs,
    };
  }

  /**
   * The notification family's publish-first/record-second pair: the API's
   * 2xx means the event is durably processed (its policy outcomes
   * committed), so only then is the row marked published. A crash between
   * the two re-delivers next tick; the API's per-recipient deduplication
   * keys make the replay a converging no-op — see this file's header.
   */
  private async dispatchNotificationEvent(event: OutboxEventRecord): Promise<void> {
    await this.deps.notificationEvents.dispatch(event);
    await this.deps.outboxEvents.markPublished(event.id, this.deps.clock.now());
  }

  /**
   * P8-EXPORT-01's enqueue family: an `export.requested` event becomes one
   * Cloud Tasks `export_generation` task and nothing else — no
   * `media.processing_job` row, because that table is keyed around a media
   * record that does not exist until the package is written; the
   * `exports.export_request` row (services/api) IS the durable job record.
   * Crash-window safety is Cloud Tasks task-name deduplication alone (task
   * name = event id), the same mechanism `processOne`'s step 2 already
   * relies on; a crash between enqueue and `markPublished` re-enqueues
   * into `ALREADY_EXISTS` next tick and then records publication.
   */
  private async enqueueExportGeneration(event: OutboxEventRecord): Promise<void> {
    const payload = event.payload as ExportRequestedEventPayload;
    const manifest: ExportGenerationManifest = {
      jobId: event.id,
      jobKind: EXPORT_GENERATION_JOB_KIND,
      exportRequestId: payload.exportRequestId,
      ...(event.traceId === null ? {} : { traceId: event.traceId }),
    };

    await this.deps.mediaProcessingQueue.enqueue({ taskName: event.id, manifest });
    await this.deps.outboxEvents.markPublished(event.id, this.deps.clock.now());
  }

  /** Returns `true` when this call actually enqueued a Cloud Tasks task, `false` when the job was already past `requested` (crash-recovery replay). */
  private async processOne(event: OutboxEventRecord): Promise<boolean> {
    const payload = event.payload as MediaProcessingRequestedEventPayload;
    const jobKind = jobKindForEventType(event.eventType);
    const now = this.deps.clock.now();

    const job = await this.deps.processingJobs.ensureRequested(
      {
        id: event.id,
        mediaId: payload.mediaId,
        processorConfigVersion: DEFAULT_PROCESSOR_CONFIG_VERSION,
        inputChecksums: payload.checksumSha256 === null ? [] : [payload.checksumSha256],
        traceId: event.traceId,
        jobKind,
      },
      now,
    );

    let wasEnqueued = false;
    if (job.state === 'requested') {
      const manifest = buildManifest(job, payload, event.traceId, job.jobKind);
      await this.deps.mediaProcessingQueue.enqueue({ taskName: job.id, manifest });
      await this.deps.processingJobs.markQueued(job.id, now);
      wasEnqueued = true;
    }

    await this.deps.outboxEvents.markPublished(event.id, now);
    return wasEnqueued;
  }
}
