/**
 * Real-PostgreSQL integration tests for the relay's own database
 * interaction: `KyselyOutboxEventStore` and `KyselyProcessingJobStore`
 * against a migrated container (the SAME migrations `@verdery/api` owns,
 * referenced by relative path for schema setup only — not an import of that
 * package's application code, so this does not cross the worker boundary).
 * The Cloud Tasks queue itself stays a fake — proving real SQL correctness
 * (the `ON CONFLICT` idempotency, the crash-recovery query shape) does not
 * need a live queue, matching this stage's own "fake queue, real outbox
 * table" completion evidence.
 *
 * Source: implementation-plan.md work package P6-ASYNC-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { MEDIA_PROCESSING_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import type { MediaProcessingRequestedEventPayload } from '@verdery/api-contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KyselyOutboxEventStore } from './kysely-outbox-event-store.js';
import { KyselyProcessingJobStore } from './kysely-processing-job-store.js';
import { OutboxRelay } from './outbox-relay.js';
import { FakeMediaProcessingQueue, fixedClock, silentLogger } from './relay-test-doubles.js';
import type { RelayDatabaseSchema } from './relay-database-schema.js';

const execFileAsync = promisify(execFile);
const SUITE_NAME = 'outbox relay integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
// The API package owns every migration; this suite applies them to a scratch
// container purely to get the real physical schema the relay reads and
// writes — see this file's own header comment.
const MIGRATIONS_DIRECTORY = new URL('../../../api/migrations', import.meta.url).pathname;

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  console.warn(
    `[skipped] ${SUITE_NAME} requires a running Docker daemon. Start Docker and re-run.`,
  );
}

const NOW = new Date('2026-07-21T09:00:00Z');

function payload(mediaId: string): MediaProcessingRequestedEventPayload {
  return {
    mediaId,
    gardenId: null,
    mediaClass: 'garden_photo',
    displayFilename: 'photo.jpg',
    bucketName: 'verdery-dev-user-media',
    objectKey: `shard/${mediaId}/object`,
    contentType: 'image/jpeg',
    byteSize: 123_456,
    checksumSha256: null,
  };
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<RelayDatabaseSchema>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<RelayDatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertMediaAndOutboxEvent(): Promise<{ eventId: string; mediaId: string }> {
    const profileId = randomUUID();
    await pool.query(
      'INSERT INTO identity_access.profile (id, firebase_uid, account_state) VALUES ($1, $2, $3)',
      [profileId, `firebase-${profileId}`, 'active'],
    );
    const mediaId = randomUUID();
    await pool.query(
      `INSERT INTO media.media_record
         (id, uploaded_by_profile_id, media_class, display_filename, declared_content_type,
          declared_byte_size, sensitivity_classification, upload_state)
       VALUES ($1, $2, 'garden_photo', 'photo.jpg', 'image/jpeg', 123456, 'standard', 'available')`,
      [mediaId, profileId],
    );

    const eventId = randomUUID();
    await pool.query(
      `INSERT INTO platform.outbox_event
         (id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
       VALUES ($1, $2, 'media_record', $3, $4, now())`,
      [eventId, MEDIA_PROCESSING_REQUESTED_EVENT_TYPE, mediaId, JSON.stringify(payload(mediaId))],
    );

    return { eventId, mediaId };
  }

  it('claims a real unpublished outbox row, creates a real processing_job row, enqueues via the fake queue, and marks both queued/published', async () => {
    const { eventId, mediaId } = await insertMediaAndOutboxEvent();
    const mediaProcessingQueue = new FakeMediaProcessingQueue();
    const relay = new OutboxRelay({
      outboxEvents: new KyselyOutboxEventStore(db),
      processingJobs: new KyselyProcessingJobStore(db),
      mediaProcessingQueue,
      clock: fixedClock(NOW),
      logger: silentLogger(),
      batchSize: 20,
    });

    const result = await relay.tick();

    expect(result).toEqual({ claimed: 1, enqueued: 1, alreadyQueued: 0, failed: 0 });
    expect(mediaProcessingQueue.enqueued).toHaveLength(1);
    expect(mediaProcessingQueue.enqueued[0]?.taskName).toBe(eventId);

    const jobRow = await pool.query(
      'SELECT id, media_id, state, revision FROM media.processing_job WHERE id = $1',
      [eventId],
    );
    expect(jobRow.rows[0]).toMatchObject({ id: eventId, media_id: mediaId, state: 'queued' });

    const outboxRow = await pool.query<{ published_at: Date | null; publish_attempts: number }>(
      'SELECT published_at, publish_attempts FROM platform.outbox_event WHERE id = $1',
      [eventId],
    );
    expect(outboxRow.rows[0]?.published_at).not.toBeNull();
    expect(outboxRow.rows[0]?.publish_attempts).toBe(1);
  });

  it('running the tick twice does not enqueue the same event twice (no unpublished rows remain after the first tick)', async () => {
    await insertMediaAndOutboxEvent();
    const mediaProcessingQueue = new FakeMediaProcessingQueue();
    const relay = new OutboxRelay({
      outboxEvents: new KyselyOutboxEventStore(db),
      processingJobs: new KyselyProcessingJobStore(db),
      mediaProcessingQueue,
      clock: fixedClock(NOW),
      logger: silentLogger(),
      batchSize: 20,
    });

    const first = await relay.tick();
    const second = await relay.tick();

    expect(first.enqueued).toBe(1);
    expect(second.claimed).toBe(0);
  });

  it('crash recovery: a job row already queued (from a run that crashed before marking the outbox row published) is not re-enqueued, only re-published', async () => {
    const { eventId, mediaId } = await insertMediaAndOutboxEvent();

    // Simulate a previous tick that successfully created and queued the job
    // but crashed before its own markPublished call.
    await pool.query(
      `INSERT INTO media.processing_job (id, media_id, state, queued_at)
       VALUES ($1, $2, 'queued', now())`,
      [eventId, mediaId],
    );

    const mediaProcessingQueue = new FakeMediaProcessingQueue();
    const relay = new OutboxRelay({
      outboxEvents: new KyselyOutboxEventStore(db),
      processingJobs: new KyselyProcessingJobStore(db),
      mediaProcessingQueue,
      clock: fixedClock(NOW),
      logger: silentLogger(),
      batchSize: 20,
    });

    const result = await relay.tick();

    expect(result).toEqual({ claimed: 1, enqueued: 0, alreadyQueued: 1, failed: 0 });
    expect(mediaProcessingQueue.enqueued).toHaveLength(0);

    const outboxRow = await pool.query<{ published_at: Date | null }>(
      'SELECT published_at FROM platform.outbox_event WHERE id = $1',
      [eventId],
    );
    expect(outboxRow.rows[0]?.published_at).not.toBeNull();
  });

  it('ignores outbox events of an unrelated event type', async () => {
    const profileId = randomUUID();
    await pool.query(
      'INSERT INTO identity_access.profile (id, firebase_uid, account_state) VALUES ($1, $2, $3)',
      [profileId, `firebase-${profileId}`, 'active'],
    );
    await pool.query(
      `INSERT INTO platform.outbox_event
         (id, event_type, aggregate_type, aggregate_id, payload, occurred_at)
       VALUES ($1, 'garden.created', 'garden', $2, '{}'::jsonb, now())`,
      [randomUUID(), randomUUID()],
    );

    const relay = new OutboxRelay({
      outboxEvents: new KyselyOutboxEventStore(db),
      processingJobs: new KyselyProcessingJobStore(db),
      mediaProcessingQueue: new FakeMediaProcessingQueue(),
      clock: fixedClock(NOW),
      logger: silentLogger(),
      batchSize: 20,
    });

    const result = await relay.tick();
    expect(result.claimed).toBe(0);
  });
});
