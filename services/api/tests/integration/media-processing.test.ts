/**
 * Full-stack integration tests for P6-ASYNC-01's media-processing pipeline
 * against real PostgreSQL: the real `CompleteMediaUpload` trigger, the real
 * `KyselyProcessingJobRepository` (standing in for the relay's own job
 * creation — see that repository's own header comment for why this is
 * legitimate), and the real `RecordMediaProcessingResult` callback command.
 *
 * This suite proves the pipeline's DATA FLOW end to end using only
 * `services/api`-owned code: `available` -> outbox event -> (simulated
 * relay job creation) -> callback -> `media_record.processingState`. The
 * relay's OWN scan-and-enqueue logic (turning an unpublished outbox row into
 * a queued job and a Cloud Tasks call) is separately, thoroughly tested in
 * `services/workers`' own suite (`src/relay/outbox-relay.test.ts`) — the two
 * halves are independently deployed processes, so combining them into one
 * test file would mean either `services/api` importing `services/workers`'
 * own persistence (or the reverse), both of which the worker boundary
 * forbids. See architecture/backend-modular-monolith.md section
 * "19. Worker Boundary".
 *
 * Source: implementation-plan.md work package P6-ASYNC-01;
 * architecture/media-storage-and-processing.md, sections "13. Processing
 * Manifest", "14. Processing Result"; architecture/asynchronous-processing.md,
 * sections "4. Transactional Outbox", "11. Idempotency".
 */

import { randomUUID } from 'node:crypto';
import { MEDIA_PROCESSING_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
import type { MediaProcessingRequestedEventPayload } from '@verdery/api-contracts';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { CompleteMediaUpload } from '../../src/modules/media/application/complete-media-upload.js';
import {
  FakeMediaStorageGateway,
  TEST_BUCKETS,
} from '../../src/modules/media/application/media-test-doubles.js';
import { RegisterMediaUpload } from '../../src/modules/media/application/register-media-upload.js';
import type { RegisterMediaUploadInput } from '../../src/modules/media/application/register-media-upload.js';
import { RecordMediaProcessingResult } from '../../src/modules/media/application/record-media-processing-result.js';
import {
  createProcessingJob,
  markProcessingJobQueued,
} from '../../src/modules/media/domain/processing-job.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { KyselyProcessingJobRepository } from '../../src/modules/media/persistence/kysely-processing-job-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media processing pipeline integration';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

const BASE_INPUT: RegisterMediaUploadInput = {
  mediaClass: 'garden_photo',
  displayFilename: 'photo.jpg',
  declaredContentType: 'image/jpeg',
  declaredByteSize: 123_456,
};

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

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
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertProfile(id: string): Promise<void> {
    await db
      .insertInto('identity_access.profile')
      .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
      .execute();
  }

  async function createGardenWithOwner(now: Date): Promise<{ gardenId: string; ownerId: string }> {
    const ownerId = randomUUID();
    await insertProfile(ownerId);
    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());
    return { gardenId: garden.id, ownerId };
  }

  /** Drives a media record all the way to `available`, returning its id and revision. */
  async function completeAnUpload(
    gardenId: string,
    ownerId: string,
    clock: Clock,
  ): Promise<{ mediaId: string }> {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const mediaIdempotency = new KyselyIdempotencyStore(db, clock);
    const mediaUnitOfWork = new KyselyMediaUnitOfWork(db, clock);
    const storage = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
    });

    const registerMediaUpload = new RegisterMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      TEST_BUCKETS,
      clock,
    );
    const session = await registerMediaUpload.execute(gardenId, ownerId, BASE_INPUT, randomUUID());

    const completeMediaUpload = new CompleteMediaUpload(
      mediaIdempotency,
      mediaUnitOfWork,
      authorization,
      storage,
      clock,
    );
    const completed = await completeMediaUpload.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );
    expect(completed.uploadState).toBe('available');

    return { mediaId: session.media.id };
  }

  it('CompleteMediaUpload reaching available appends an unpublished media.processing_requested outbox event', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const clock = fixedClock(now);
    const { gardenId, ownerId } = await createGardenWithOwner(now);

    const { mediaId } = await completeAnUpload(gardenId, ownerId, clock);

    const outboxRow = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', MEDIA_PROCESSING_REQUESTED_EVENT_TYPE)
      .executeTakeFirstOrThrow();

    expect(outboxRow.published_at).toBeNull();
    expect(outboxRow.aggregate_type).toBe('media_record');
    const payload = outboxRow.payload as MediaProcessingRequestedEventPayload;
    expect(payload).toMatchObject({
      mediaId,
      gardenId,
      mediaClass: 'garden_photo',
      contentType: 'image/jpeg',
      byteSize: 123_456,
    });
  });

  it('reaching available results in a durable processing_job row once a job is created for it, and the callback resolves it to processed', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const later = new Date('2026-07-21T09:05:00Z');
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const { mediaId } = await completeAnUpload(gardenId, ownerId, fixedClock(now));

    const outboxRow = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', MEDIA_PROCESSING_REQUESTED_EVENT_TYPE)
      .executeTakeFirstOrThrow();

    // Simulates the relay: create a durable job row keyed by the outbox
    // event's own id (see migrations/1785200000000_media-processing-jobs.sql
    // for why), then mark it queued — exactly what
    // `services/workers`' relay does before it calls Cloud Tasks.
    const processingJobRepository = new KyselyProcessingJobRepository(db);
    const requested = createProcessingJob(
      { id: outboxRow.id, mediaId, processorConfigVersion: 'v1', inputChecksums: [] },
      now,
    );
    await processingJobRepository.insert(requested);
    const queued = markProcessingJobQueued(requested, now);
    await processingJobRepository.updateState(queued, requested.revision);

    // The callback: Cloud Tasks would deliver this HTTP call after the relay
    // enqueues it; here it is invoked directly against the real command.
    const recordMediaProcessingResult = new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(db, fixedClock(later)),
      fixedClock(later),
    );
    await recordMediaProcessingResult.execute(outboxRow.id);

    const mediaRepository = new KyselyMediaRepository(db);
    const media = await mediaRepository.get(mediaId);
    expect(media?.processingState).toBe('processed');

    const jobAfter = await processingJobRepository.get(outboxRow.id);
    expect(jobAfter?.state).toBe('succeeded');
    expect(jobAfter?.outcomeCode).toBe('placeholder_derivative_generation');
    expect(jobAfter?.completedAt).toEqual(later);
  });

  it('two concurrent callback deliveries for the same job resolve safely: exactly one wins, neither throws, and the media record advances exactly once', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const { mediaId } = await completeAnUpload(gardenId, ownerId, fixedClock(now));

    const outboxRow = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', MEDIA_PROCESSING_REQUESTED_EVENT_TYPE)
      .executeTakeFirstOrThrow();

    const processingJobRepository = new KyselyProcessingJobRepository(db);
    const requested = createProcessingJob(
      { id: outboxRow.id, mediaId, processorConfigVersion: 'v1', inputChecksums: [] },
      now,
    );
    await processingJobRepository.insert(requested);
    const queued = markProcessingJobQueued(requested, now);
    await processingJobRepository.updateState(queued, requested.revision);

    const recordFirst = new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );
    const recordSecond = new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );

    await expect(
      Promise.all([recordFirst.execute(outboxRow.id), recordSecond.execute(outboxRow.id)]),
    ).resolves.toBeDefined();

    const mediaRepository = new KyselyMediaRepository(db);
    const media = await mediaRepository.get(mediaId);
    expect(media?.processingState).toBe('processed');

    const jobAfter = await processingJobRepository.get(outboxRow.id);
    expect(jobAfter?.state).toBe('succeeded');
    // registered(1) -> authorized(2) -> uploading(3) -> verifying(4) ->
    // available(5) -> processing(6) -> processed(7): exactly one winner
    // advanced the media record by exactly one job's worth (+2), never two
    // (which would read 9) and never zero (which would read 5).
    expect(media?.revision).toBe(7);
  });

  it('a duplicate callback delivery after the job already succeeded is a silent no-op', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const { mediaId } = await completeAnUpload(gardenId, ownerId, fixedClock(now));

    const outboxRow = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', MEDIA_PROCESSING_REQUESTED_EVENT_TYPE)
      .executeTakeFirstOrThrow();

    const processingJobRepository = new KyselyProcessingJobRepository(db);
    const requested = createProcessingJob(
      { id: outboxRow.id, mediaId, processorConfigVersion: 'v1', inputChecksums: [] },
      now,
    );
    await processingJobRepository.insert(requested);
    await processingJobRepository.updateState(
      markProcessingJobQueued(requested, now),
      requested.revision,
    );

    const recordMediaProcessingResult = new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );
    await recordMediaProcessingResult.execute(outboxRow.id);
    const jobAfterFirst = await processingJobRepository.get(outboxRow.id);

    await recordMediaProcessingResult.execute(outboxRow.id);
    const jobAfterSecond = await processingJobRepository.get(outboxRow.id);

    expect(jobAfterSecond).toEqual(jobAfterFirst);
  });
});
