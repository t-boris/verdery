import { describe, expect, it } from 'vitest';
import {
  MEDIA_DELETION_REQUESTED_EVENT_TYPE,
  MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
  MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
  type MediaDeletionRequestedEventPayload,
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
    batchSize?: number;
  } = {},
) {
  const outboxEvents = options.outboxEvents ?? new FakeOutboxEventStore();
  const processingJobs = options.processingJobs ?? new FakeProcessingJobStore();
  const mediaProcessingQueue = options.mediaProcessingQueue ?? new FakeMediaProcessingQueue();

  const relay = new OutboxRelay({
    outboxEvents,
    processingJobs,
    mediaProcessingQueue,
    clock: fixedClock(NOW),
    logger: silentLogger(),
    batchSize: options.batchSize ?? 20,
  });

  return { relay, outboxEvents, processingJobs, mediaProcessingQueue };
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
      failed: 0,
      oldestClaimedEventAgeMs: 0,
    });
    expect(processingJobs.jobs.get(eventId)?.jobKind).toBe(MEDIA_DELETION_JOB_KIND);
    const manifest = mediaProcessingQueue.enqueued[0]?.manifest;
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
});
