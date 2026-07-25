/**
 * Full-stack integration tests for P6-WORKER-02's derivative-generation
 * chaining and idempotency against real PostgreSQL — the SAME "real
 * `CompleteMediaUpload`/`RecordMediaProcessingResult`, simulated relay job
 * creation" shape `media-processing.test.ts` already established for
 * P6-ASYNC-01/P6-WORKER-01, split into its own file (rather than growing
 * that one past this repository's 600-line file-size rule) once this stage
 * added enough of its own scenarios to justify it.
 *
 * Covers: a successful validation result for a raster-eligible media class
 * appends the derivative-generation outbox event; a derivative-generation
 * job's result registers a real, distinct `media_record` row; regenerating
 * the exact same derivative across two independent jobs is a real,
 * database-backed no-op (the two partial unique indexes
 * migrations/1785300000000_media-derivative-identity.sql adds); a genuinely
 * new `transformationVersion` produces a second, distinct row.
 *
 * Source: implementation-plan.md work package P6-WORKER-02;
 * architecture/media-storage-and-processing.md, section "9. Image Derivatives".
 */

import { randomUUID } from 'node:crypto';
import {
  MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE,
  MEDIA_PROCESSING_REQUESTED_EVENT_TYPE,
} from '@verdery/api-contracts';
import type {
  MediaProcessingOutputObject,
  MediaProcessingRequestedEventPayload,
} from '@verdery/api-contracts';
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
  MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
} from '../../src/modules/media/domain/processing-job.js';
import { KyselyMediaRepository } from '../../src/modules/media/persistence/kysely-media-repository.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { KyselyProcessingJobRepository } from '../../src/modules/media/persistence/kysely-processing-job-repository.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media derivative generation integration';
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

  /** Drives a media record all the way to `available`, returning its id. */
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

  /** Drives a media record through `available` AND a successful `media_validation` result — the state a derivative-generation job's own source is always in. */
  async function completeAndValidate(
    gardenId: string,
    ownerId: string,
    now: Date,
  ): Promise<{ mediaId: string }> {
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
      TEST_BUCKETS.derived,
    );
    await recordMediaProcessingResult.execute(outboxRow.id, {
      jobId: outboxRow.id,
      processorVersion: 'media-validator-v1',
      inputChecksums: ['e'.repeat(64)],
      outputObjects: [],
      resultSummary: { accepted: true, detectedContentType: 'image/jpeg', byteSize: 123_456 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 30 },
      outcome: 'succeeded',
    });

    return { mediaId };
  }

  function thumbnailOutput(
    overrides: Partial<MediaProcessingOutputObject> = {},
  ): MediaProcessingOutputObject {
    return {
      bucketName: 'derived-bucket',
      objectKey: `ab/${randomUUID()}/thumb-${randomUUID()}`,
      checksumSha256: 'f'.repeat(64),
      contentType: 'image/jpeg',
      byteSize: 8_000,
      derivativeKind: 'thumbnail',
      transformationVersion: 1,
      ...overrides,
    };
  }

  it('a successful validation result for a raster-eligible media class appends an unpublished media.derivative_generation_requested outbox event', async () => {
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

    const validationChecksum = 'e'.repeat(64);
    const recordMediaProcessingResult = new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(db, fixedClock(later)),
      fixedClock(later),
      TEST_BUCKETS.derived,
    );
    await recordMediaProcessingResult.execute(outboxRow.id, {
      jobId: outboxRow.id,
      processorVersion: 'media-validator-v1',
      inputChecksums: [validationChecksum],
      outputObjects: [],
      resultSummary: { accepted: true, detectedContentType: 'image/jpeg', byteSize: 123_456 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 30 },
      outcome: 'succeeded',
    });

    const derivativeEvent = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', MEDIA_DERIVATIVE_GENERATION_REQUESTED_EVENT_TYPE)
      .executeTakeFirstOrThrow();

    expect(derivativeEvent.published_at).toBeNull();
    const payload = derivativeEvent.payload as MediaProcessingRequestedEventPayload;
    expect(payload).toMatchObject({
      mediaId,
      gardenId,
      mediaClass: 'garden_photo',
      contentType: 'image/jpeg',
      byteSize: 123_456,
      checksumSha256: validationChecksum,
    });
  });

  it('registers a produced derivative as its own real media.media_record row, distinct from the source', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const { mediaId } = await completeAndValidate(gardenId, ownerId, now);

    const jobId = randomUUID();
    const processingJobRepository = new KyselyProcessingJobRepository(db);
    const derivativeJob = createProcessingJob(
      {
        id: jobId,
        mediaId,
        processorConfigVersion: 'v1',
        inputChecksums: ['e'.repeat(64)],
        jobKind: MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
      },
      now,
    );
    await processingJobRepository.insert(derivativeJob);
    await processingJobRepository.updateState(
      markProcessingJobQueued(derivativeJob, now),
      derivativeJob.revision,
    );

    const recordMediaProcessingResult = new RecordMediaProcessingResult(
      new KyselyMediaUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
      TEST_BUCKETS.derived,
    );
    const output = thumbnailOutput();
    await recordMediaProcessingResult.execute(jobId, {
      jobId,
      processorVersion: 'media-derivative-generator-v1',
      inputChecksums: ['e'.repeat(64)],
      outputObjects: [output],
      resultSummary: { derivativeCount: 1 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 50 },
      outcome: 'succeeded',
    });

    const derivativeRow = await db
      .selectFrom('media.media_record')
      .selectAll()
      .where('bucket_name', '=', output.bucketName)
      .where('object_key', '=', output.objectKey)
      .executeTakeFirstOrThrow();

    expect(derivativeRow.id).not.toBe(mediaId);
    expect(derivativeRow.media_class).toBe('derived_preview');
    expect(derivativeRow.derived_from_media_id).toBe(mediaId);
    expect(derivativeRow.transformation_version).toBe(1);
    expect(derivativeRow.derivative_kind).toBe('thumbnail');
    expect(derivativeRow.upload_state).toBe('available');

    // The source media's own processingState/revision are untouched by this
    // second job — see record-media-processing-result.ts's own header
    // comment for why.
    const source = await new KyselyMediaRepository(db).get(mediaId);
    expect(source?.processingState).toBe('processed');
  });

  it('regenerating the exact same derivative for the same source+version+kind across two independent jobs is a real, database-backed no-op', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const { mediaId } = await completeAndValidate(gardenId, ownerId, now);
    const processingJobRepository = new KyselyProcessingJobRepository(db);
    const mediaRepository = new KyselyMediaRepository(db);
    const output = thumbnailOutput();

    async function runDerivativeJob(): Promise<void> {
      const jobId = randomUUID();
      const job = createProcessingJob(
        {
          id: jobId,
          mediaId,
          processorConfigVersion: 'v1',
          inputChecksums: ['e'.repeat(64)],
          jobKind: MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
        },
        now,
      );
      await processingJobRepository.insert(job);
      await processingJobRepository.updateState(markProcessingJobQueued(job, now), job.revision);

      const recordMediaProcessingResult = new RecordMediaProcessingResult(
        new KyselyMediaUnitOfWork(db, fixedClock(now)),
        fixedClock(now),
        TEST_BUCKETS.derived,
      );
      await recordMediaProcessingResult.execute(jobId, {
        jobId,
        processorVersion: 'media-derivative-generator-v1',
        inputChecksums: ['e'.repeat(64)],
        // The SAME output object (same bucket/object key/checksum) on both
        // runs — a real regeneration, not a duplicate delivery of the same
        // job id (already covered by media-processing.test.ts's own
        // generic job-state no-op).
        outputObjects: [output],
        resultSummary: { derivativeCount: 1 },
        qualityDiagnostics: null,
        resourceMetrics: { durationMs: 50 },
        outcome: 'succeeded',
      });
    }

    await runDerivativeJob();
    const derivative = await mediaRepository.findDerivative({
      derivedFromMediaId: mediaId,
      transformationVersion: 1,
      derivativeKind: 'thumbnail',
      tile: null,
    });
    expect(derivative).not.toBeNull();

    await runDerivativeJob();

    const rows = await db
      .selectFrom('media.media_record')
      .select(({ fn }) => [fn.count<string>('id').as('count')])
      .where('derived_from_media_id', '=', mediaId)
      .executeTakeFirstOrThrow();
    expect(Number(rows.count)).toBe(1);
  });

  it('a genuinely new transformationVersion produces a second, distinct derivative row for the same source', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { gardenId, ownerId } = await createGardenWithOwner(now);
    const { mediaId } = await completeAndValidate(gardenId, ownerId, now);
    const processingJobRepository = new KyselyProcessingJobRepository(db);

    async function runDerivativeJob(output: MediaProcessingOutputObject): Promise<void> {
      const jobId = randomUUID();
      const job = createProcessingJob(
        {
          id: jobId,
          mediaId,
          processorConfigVersion: 'v1',
          inputChecksums: ['e'.repeat(64)],
          jobKind: MEDIA_DERIVATIVE_GENERATION_JOB_KIND,
        },
        now,
      );
      await processingJobRepository.insert(job);
      await processingJobRepository.updateState(markProcessingJobQueued(job, now), job.revision);
      const recordMediaProcessingResult = new RecordMediaProcessingResult(
        new KyselyMediaUnitOfWork(db, fixedClock(now)),
        fixedClock(now),
        TEST_BUCKETS.derived,
      );
      await recordMediaProcessingResult.execute(jobId, {
        jobId,
        processorVersion: 'media-derivative-generator-v1',
        inputChecksums: ['e'.repeat(64)],
        outputObjects: [output],
        resultSummary: { derivativeCount: 1 },
        qualityDiagnostics: null,
        resourceMetrics: { durationMs: 50 },
        outcome: 'succeeded',
      });
    }

    await runDerivativeJob(thumbnailOutput({ transformationVersion: 1 }));
    await runDerivativeJob(thumbnailOutput({ transformationVersion: 2 }));

    const rows = await db
      .selectFrom('media.media_record')
      .select(({ fn }) => [fn.count<string>('id').as('count')])
      .where('derived_from_media_id', '=', mediaId)
      .executeTakeFirstOrThrow();
    expect(Number(rows.count)).toBe(2);
  });
});
