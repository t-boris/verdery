import { describe, expect, it } from 'vitest';
import {
  EXPORT_COMPLETED_EVENT_TYPE,
  EXPORT_GENERATION_JOB_KIND,
  EXPORT_REQUESTED_EVENT_TYPE,
  MEDIA_DELETION_REQUESTED_EVENT_TYPE,
  MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
  MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
  RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
  type MediaDeletionRequestedEventPayload,
  type MediaProcessingManifest,
  type MediaProcessingRequestedEventPayload,
} from '@verdery/api-contracts';
import {
  MEDIA_DELETION_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
  MEDIA_VALIDATION_JOB_KIND,
} from '../job-kind.js';
import { OutboxRelay } from './outbox-relay.js';
import {
  FakeMediaProcessingQueue,
  FakeNotificationEventDispatcher,
  FakeOutboxEventStore,
  FakeProcessingJobStore,
  fixedClock,
  silentLogger,
} from './relay-test-doubles.js';

const NOW = new Date('2026-07-21T09:00:00Z');

function payload(
  overrides: Partial<MediaProcessingRequestedEventPayload> = {},
): MediaProcessingRequestedEventPayload {
  return {
    mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01',
    gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c02',
    mediaClass: 'garden_photo',
    displayFilename: 'photo.jpg',
    bucketName: 'verdery-dev-user-media',
    objectKey: 'shard/019827ab.../object',
    contentType: 'image/jpeg',
    byteSize: 123_456,
    checksumSha256: null,
    ...overrides,
  };
}

function buildRelay(
  options: {
    outboxEvents?: FakeOutboxEventStore;
    processingJobs?: FakeProcessingJobStore;
    mediaProcessingQueue?: FakeMediaProcessingQueue;
    notificationEvents?: FakeNotificationEventDispatcher;
    batchSize?: number;
  } = {},
) {
  const outboxEvents = options.outboxEvents ?? new FakeOutboxEventStore();
  const processingJobs = options.processingJobs ?? new FakeProcessingJobStore();
  const mediaProcessingQueue = options.mediaProcessingQueue ?? new FakeMediaProcessingQueue();
  const notificationEvents = options.notificationEvents ?? new FakeNotificationEventDispatcher();

  const relay = new OutboxRelay({
    outboxEvents,
    processingJobs,
    mediaProcessingQueue,
    notificationEvents,
    clock: fixedClock(NOW),
    logger: silentLogger(),
    batchSize: options.batchSize ?? 20,
  });

  return { relay, outboxEvents, processingJobs, mediaProcessingQueue, notificationEvents };
}

describe('OutboxRelay.tick', () => {
  it('creates a requested job, enqueues it, marks it queued, and publishes the outbox row', async () => {
    const { relay, outboxEvents, processingJobs, mediaProcessingQueue } = buildRelay();
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00',
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload(),
      traceId: 'trace-1',
      occurredAt: NOW,
    });

    const result = await relay.tick();

    expect(result).toEqual({
      claimed: 1,
      enqueued: 1,
      alreadyQueued: 0,
      notificationsDispatched: 0,
      failed: 0,
      oldestClaimedEventAgeMs: 0,
    });
    expect(mediaProcessingQueue.enqueued).toHaveLength(1);
    expect(mediaProcessingQueue.enqueued[0]).toMatchObject({
      taskName: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00',
      manifest: {
        jobId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00',
        mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01',
        inputObjects: [
          { bucketName: 'verdery-dev-user-media', objectKey: 'shard/019827ab.../object' },
        ],
        expectedChecksums: [],
        validation: {
          mediaClass: 'garden_photo',
          displayFilename: 'photo.jpg',
          expectedContentType: 'image/jpeg',
          expectedByteSize: 123_456,
        },
        traceId: 'trace-1',
      },
    });

    const job = processingJobs.jobs.get('019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00');
    expect(job?.state).toBe('queued');
    expect(outboxEvents.markPublishedCalls).toEqual(['019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00']);
  });

  it('is idempotent when run twice in a row: the second tick finds nothing left unpublished', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00',
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload(),
      traceId: null,
      occurredAt: NOW,
    });
    const { relay } = buildRelay({ outboxEvents });

    const first = await relay.tick();
    const second = await relay.tick();

    expect(first.enqueued).toBe(1);
    expect(second).toEqual({
      claimed: 0,
      enqueued: 0,
      alreadyQueued: 0,
      notificationsDispatched: 0,
      failed: 0,
      oldestClaimedEventAgeMs: null,
    });
  });

  it('crash recovery: a job already queued from a previous tick is not re-enqueued, only the outbox row is published', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    const eventId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c00';
    outboxEvents.seed({
      id: eventId,
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload(),
      traceId: null,
      occurredAt: NOW,
    });
    const processingJobs = new FakeProcessingJobStore();
    // Simulates: a previous tick already created the job and successfully
    // enqueued+queued it, then crashed before marking the outbox row
    // published.
    processingJobs.seed({
      id: eventId,
      mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c01',
      processorConfigVersion: 'v1',
      state: 'queued',
      jobKind: MEDIA_VALIDATION_JOB_KIND,
    });
    const { relay, mediaProcessingQueue } = buildRelay({ outboxEvents, processingJobs });

    const result = await relay.tick();

    expect(result).toEqual({
      claimed: 1,
      enqueued: 0,
      alreadyQueued: 1,
      notificationsDispatched: 0,
      failed: 0,
      oldestClaimedEventAgeMs: 0,
    });
    expect(mediaProcessingQueue.enqueued).toHaveLength(0);
    expect(outboxEvents.markPublishedCalls).toEqual([eventId]);
  });

  it('processes a full batch of multiple unpublished events', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    for (let index = 0; index < 5; index += 1) {
      outboxEvents.seed({
        id: `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c1${index}`,
        aggregateId: `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c2${index}`,
        eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
        payload: payload({ mediaId: `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c2${index}` }),
        traceId: null,
        occurredAt: NOW,
      });
    }
    const { relay, mediaProcessingQueue } = buildRelay({ outboxEvents });

    const result = await relay.tick();

    expect(result).toEqual({
      claimed: 5,
      enqueued: 5,
      alreadyQueued: 0,
      notificationsDispatched: 0,
      failed: 0,
      oldestClaimedEventAgeMs: 0,
    });
    expect(mediaProcessingQueue.enqueued).toHaveLength(5);
  });

  it('respects batchSize: claims no more than the configured limit in one tick', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    for (let index = 0; index < 5; index += 1) {
      outboxEvents.seed({
        id: `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c1${index}`,
        aggregateId: `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c2${index}`,
        eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
        payload: payload({ mediaId: `019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c2${index}` }),
        traceId: null,
        occurredAt: NOW,
      });
    }
    const { relay } = buildRelay({ outboxEvents, batchSize: 2 });

    const result = await relay.tick();

    expect(result.claimed).toBe(2);
  });

  it('a queue failure for one event leaves it unpublished and does not stop the rest of the batch', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c10',
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c20',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c20' }),
      traceId: null,
      occurredAt: NOW,
    });
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c11',
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c21',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c21' }),
      traceId: null,
      occurredAt: NOW,
    });
    const mediaProcessingQueue = new FakeMediaProcessingQueue();
    mediaProcessingQueue.rejectNextWith = new Error('Cloud Tasks temporarily unavailable');
    const { relay, processingJobs } = buildRelay({ outboxEvents, mediaProcessingQueue });

    const result = await relay.tick();

    expect(result).toEqual({
      claimed: 2,
      enqueued: 1,
      alreadyQueued: 0,
      notificationsDispatched: 0,
      failed: 1,
      oldestClaimedEventAgeMs: 0,
    });
    // Exactly one of the two jobs reached queued; the other stayed requested
    // and its outbox row stays unpublished, ready to retry next tick.
    const queuedCount = [...processingJobs.jobs.values()].filter(
      (job) => job.state === 'queued',
    ).length;
    expect(queuedCount).toBe(1);
    expect(outboxEvents.markPublishedCalls).toHaveLength(1);
  });

  it('a media.derivative_generation_requested event creates a derivative_generation job, carrying jobKind on its Cloud Tasks manifest (P6-WORKER-02)', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    const eventId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c30';
    outboxEvents.seed({
      id: eventId,
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c31',
      eventType: MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
      payload: payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c31' }),
      traceId: null,
      occurredAt: NOW,
    });
    const { relay, processingJobs, mediaProcessingQueue } = buildRelay({ outboxEvents });

    const result = await relay.tick();

    expect(result).toEqual({
      claimed: 1,
      enqueued: 1,
      alreadyQueued: 0,
      notificationsDispatched: 0,
      failed: 0,
      oldestClaimedEventAgeMs: 0,
    });
    expect(processingJobs.jobs.get(eventId)?.jobKind).toBe(MEDIA_DERIVATIVE_GENERATION_JOB_KIND);
    expect(mediaProcessingQueue.enqueued[0]?.manifest.jobKind).toBe(
      MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
    );
  });

  it('a media.processing_requested event still creates a media_validation job with jobKind set explicitly on its manifest', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    const eventId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c40';
    outboxEvents.seed({
      id: eventId,
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c41',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c41' }),
      traceId: null,
      occurredAt: NOW,
    });
    const { relay, processingJobs, mediaProcessingQueue } = buildRelay({ outboxEvents });

    await relay.tick();

    expect(processingJobs.jobs.get(eventId)?.jobKind).toBe(MEDIA_VALIDATION_JOB_KIND);
    expect(mediaProcessingQueue.enqueued[0]?.manifest.jobKind).toBe(MEDIA_VALIDATION_JOB_KIND);
  });

  it('a media.deletion_requested event creates a media_deletion job whose manifest carries the deletion prefixes and no expected checksums (P6-RET-01)', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    const eventId = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c50';
    const deletionPayload: MediaDeletionRequestedEventPayload = {
      ...payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c51', checksumSha256: null }),
      objectPrefixes: [
        { bucketName: 'verdery-dev-user-media', objectKeyPrefix: 'ab/media-id/' },
        { bucketName: 'verdery-dev-derived', objectKeyPrefix: 'ab/media-id/' },
      ],
    };
    outboxEvents.seed({
      id: eventId,
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c51',
      eventType: MEDIA_DELETION_REQUESTED_EVENT_TYPE,
      payload: deletionPayload,
      traceId: null,
      occurredAt: NOW,
    });
    const { relay, processingJobs, mediaProcessingQueue } = buildRelay({ outboxEvents });

    const result = await relay.tick();

    expect(result).toEqual({
      claimed: 1,
      enqueued: 1,
      alreadyQueued: 0,
      notificationsDispatched: 0,
      failed: 0,
      oldestClaimedEventAgeMs: 0,
    });
    expect(processingJobs.jobs.get(eventId)?.jobKind).toBe(MEDIA_DELETION_JOB_KIND);
    // The queue carries the manifest union since P8-EXPORT-01; this event
    // is a media-family one, so the media manifest shape applies.
    const manifest = mediaProcessingQueue.enqueued[0]?.manifest as
      MediaProcessingManifest | undefined;
    expect(manifest?.jobKind).toBe(MEDIA_DELETION_JOB_KIND);
    expect(manifest?.expectedChecksums).toEqual([]);
    expect(manifest?.deletion).toEqual({
      objectPrefixes: deletionPayload.objectPrefixes,
    });
  });

  it('reports the oldest claimed event`s age as the outbox-publication-lag signal (P6-OBS-01)', async () => {
    const outboxEvents = new FakeOutboxEventStore();
    // Deliberately seeded newest-first: the relay must find the oldest
    // event's age regardless of the store's returned order.
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c60',
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c61',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c61' }),
      traceId: null,
      occurredAt: new Date(NOW.getTime() - 2_000),
    });
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c62',
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c63',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c63' }),
      traceId: null,
      occurredAt: new Date(NOW.getTime() - 12_000),
    });
    const { relay } = buildRelay({ outboxEvents });

    const result = await relay.tick();

    expect(result.oldestClaimedEventAgeMs).toBe(12_000);
  });

  // P7-NOTIF-01: the notification event family — forwarded to the API's
  // policy endpoint, never turned into a media-processing job.
  const NOTIFICATION_EVENT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c70';

  function seedNotificationEvent(outboxEvents: FakeOutboxEventStore): void {
    outboxEvents.seed({
      id: NOTIFICATION_EVENT_ID,
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c71',
      eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
      payload: { candidateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c71' },
      traceId: 'trace-n1',
      occurredAt: NOW,
    });
  }

  it('forwards a candidate-created event whole, then publishes — never touching the job store or the queue', async () => {
    const { relay, outboxEvents, processingJobs, mediaProcessingQueue, notificationEvents } =
      buildRelay();
    seedNotificationEvent(outboxEvents);

    const result = await relay.tick();

    expect(result).toEqual({
      claimed: 1,
      enqueued: 0,
      alreadyQueued: 0,
      notificationsDispatched: 1,
      failed: 0,
      oldestClaimedEventAgeMs: 0,
    });
    expect(notificationEvents.dispatched).toHaveLength(1);
    expect(notificationEvents.dispatched[0]).toMatchObject({
      id: NOTIFICATION_EVENT_ID,
      eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
      payload: { candidateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c71' },
      traceId: 'trace-n1',
    });
    expect(processingJobs.jobs.size).toBe(0);
    expect(mediaProcessingQueue.enqueued).toHaveLength(0);
    expect(outboxEvents.markPublishedCalls).toEqual([NOTIFICATION_EVENT_ID]);
  });

  it('leaves a failed notification dispatch unpublished and re-forwards it next tick — the API side deduplicates', async () => {
    const { relay, outboxEvents, notificationEvents } = buildRelay();
    seedNotificationEvent(outboxEvents);
    notificationEvents.rejectNextWith = new Error('api unavailable');

    const first = await relay.tick();
    expect(first).toMatchObject({ claimed: 1, notificationsDispatched: 0, failed: 1 });
    expect(outboxEvents.markPublishedCalls).toEqual([]);

    // Next tick: the SAME event is re-delivered; the fake mirrors the real
    // endpoint's dedup summary shape.
    const second = await relay.tick();
    expect(second).toMatchObject({ claimed: 1, notificationsDispatched: 1, failed: 0 });
    expect(outboxEvents.markPublishedCalls).toEqual([NOTIFICATION_EVENT_ID]);
  });

  it('keeps one notification failure from blocking the media events in the same batch, and vice versa', async () => {
    const { relay, outboxEvents, notificationEvents, mediaProcessingQueue } = buildRelay();
    seedNotificationEvent(outboxEvents);
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c80',
      aggregateId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c81',
      eventType: MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
      payload: payload({ mediaId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c81' }),
      traceId: null,
      occurredAt: NOW,
    });
    notificationEvents.rejectNextWith = new Error('api unavailable');

    const result = await relay.tick();

    expect(result).toMatchObject({
      claimed: 2,
      enqueued: 1,
      notificationsDispatched: 0,
      failed: 1,
    });
    expect(mediaProcessingQueue.enqueued).toHaveLength(1);
    expect(outboxEvents.markPublishedCalls).toEqual(['019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c80']);
  });

  const EXPORT_EVENT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c90';
  const EXPORT_REQUEST_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c91';

  it('an export.requested event enqueues one export_generation task by event id — no processing_job row (P8-EXPORT-01)', async () => {
    const { relay, outboxEvents, processingJobs, mediaProcessingQueue } = buildRelay();
    outboxEvents.seed({
      id: EXPORT_EVENT_ID,
      aggregateId: EXPORT_REQUEST_ID,
      eventType: EXPORT_REQUESTED_EVENT_TYPE,
      payload: {
        exportRequestId: EXPORT_REQUEST_ID,
        requesterProfileId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c92',
        scope: 'account',
        gardenId: null,
        includeMedia: true,
      },
      traceId: 'trace-e1',
      occurredAt: NOW,
    });

    const result = await relay.tick();

    expect(result).toMatchObject({ claimed: 1, enqueued: 1, failed: 0 });
    expect(processingJobs.jobs.size).toBe(0);
    expect(mediaProcessingQueue.enqueued).toHaveLength(1);
    expect(mediaProcessingQueue.enqueued[0]).toEqual({
      taskName: EXPORT_EVENT_ID,
      manifest: {
        jobId: EXPORT_EVENT_ID,
        jobKind: EXPORT_GENERATION_JOB_KIND,
        exportRequestId: EXPORT_REQUEST_ID,
        traceId: 'trace-e1',
      },
    });
    expect(outboxEvents.markPublishedCalls).toEqual([EXPORT_EVENT_ID]);

    // A second tick after a crash-window replay converges: the queue's own
    // task-name dedup absorbs the repeat.
    outboxEvents.rows.get(EXPORT_EVENT_ID)!.publishedAt = null;
    await relay.tick();
    expect(mediaProcessingQueue.enqueued).toHaveLength(1);
  });

  it('an export.completed event is FORWARDED to the notification endpoint, never enqueued (P8-EXPORT-01)', async () => {
    const { relay, outboxEvents, notificationEvents, mediaProcessingQueue, processingJobs } =
      buildRelay();
    outboxEvents.seed({
      id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9c95',
      aggregateId: EXPORT_REQUEST_ID,
      eventType: EXPORT_COMPLETED_EVENT_TYPE,
      payload: { exportRequestId: EXPORT_REQUEST_ID },
      traceId: null,
      occurredAt: NOW,
    });

    const result = await relay.tick();

    expect(result).toMatchObject({ claimed: 1, notificationsDispatched: 1, enqueued: 0 });
    expect(notificationEvents.dispatched).toHaveLength(1);
    expect(notificationEvents.dispatched[0]?.eventType).toBe(EXPORT_COMPLETED_EVENT_TYPE);
    expect(mediaProcessingQueue.enqueued).toHaveLength(0);
    expect(processingJobs.jobs.size).toBe(0);
  });
});
