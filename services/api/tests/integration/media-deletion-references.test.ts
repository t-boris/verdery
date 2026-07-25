/**
 * The attachment-reference half of P6-RET-01's deletion race evidence,
 * split out of `media-deletion.test.ts` purely for the repository's
 * 600-line source-file rule (the same split reasoning
 * `media-derivative-generation.test.ts` documents): both orderings of "an
 * attachment reference appearing while deletion is scheduled", against the
 * real plants-inventory attach command and the real database's transaction
 * rollback —
 *
 * - attach first, delete second: `409 media.referenced`, and the WHOLE
 *   deletion transaction rolls back (record stays `available`, queued jobs
 *   survive, no deletion event, no audit row);
 * - delete first, attach second: the attach-side availability gate rejects
 *   the reference and inserts nothing.
 *
 * See `media-deletion-workflow.ts`'s own lock-ordering comment for why
 * these two orderings are the whole race.
 */

import { randomUUID } from 'node:crypto';
import { MEDIA_DELETION_REQUESTED_EVENT_TYPE } from '@verdery/api-contracts';
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
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { AttachPlantPhoto } from '../../src/modules/plants-inventory/application/attach-plant-photo.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { CompleteMediaUpload } from '../../src/modules/media/application/complete-media-upload.js';
import { DeleteGardenMedia } from '../../src/modules/media/application/delete-garden-media.js';
import {
  FakeMediaStorageGateway,
  TEST_BUCKETS,
} from '../../src/modules/media/application/media-test-doubles.js';
import { RegisterMediaUpload } from '../../src/modules/media/application/register-media-upload.js';
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

const SUITE_NAME = 'media deletion attachment-reference races';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NOW = new Date('2026-07-21T09:00:00Z');
const VALIDATION_CHECKSUM = 'e'.repeat(64);

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyMediaUnitOfWork(db, clock);
    const storage = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
    });

    return {
      registerMediaUpload: new RegisterMediaUpload(
        idempotency,
        unitOfWork,
        authorization,
        storage,
        TEST_BUCKETS,
        clock,
      ),
      completeMediaUpload: new CompleteMediaUpload(
        idempotency,
        unitOfWork,
        authorization,
        storage,
        clock,
      ),
      deleteGardenMedia: new DeleteGardenMedia(
        idempotency,
        unitOfWork,
        authorization,
        TEST_BUCKETS,
        clock,
      ),
      recordResult: new RecordMediaProcessingResult(unitOfWork, clock, TEST_BUCKETS.derived),
    };
  }

  function buildPlantHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const idempotency = new KyselyIdempotencyStore(db, clock);
    return {
      addPlant: new AddPlant(idempotency, unitOfWork, authorization, clock),
      attachPlantPhoto: new AttachPlantPhoto(
        new KyselyPlantRepository(db),
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
    };
  }

  async function createGardenWithOwner(): Promise<{ gardenId: string; ownerId: string }> {
    const ownerId = randomUUID();
    await db
      .insertInto('identity_access.profile')
      .values({ id: ownerId, firebase_uid: `firebase-${ownerId}`, account_state: 'active' })
      .execute();
    const clock = fixedClock(NOW);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', randomUUID());
    return { gardenId: garden.id, ownerId };
  }

  /** Drives a fresh upload to `available` AND `processed` (successful validation), returning its id. */
  async function completeAndValidate(gardenId: string, ownerId: string): Promise<string> {
    const handlers = buildHandlers(fixedClock(NOW));
    const session = await handlers.registerMediaUpload.execute(
      gardenId,
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'photo.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      randomUUID(),
    );
    await handlers.completeMediaUpload.execute(
      gardenId,
      session.media.id,
      ownerId,
      session.media.revision,
      randomUUID(),
    );
    const jobId = await seedQueuedJob(session.media.id, 'media_validation', []);
    await handlers.recordResult.execute(jobId, {
      jobId,
      processorVersion: 'media-validator-v1',
      inputChecksums: [VALIDATION_CHECKSUM],
      outputObjects: [],
      resultSummary: { accepted: true, detectedContentType: 'image/jpeg', byteSize: 123_456 },
      qualityDiagnostics: null,
      resourceMetrics: { durationMs: 30 },
      outcome: 'succeeded',
    });
    return session.media.id;
  }

  async function seedQueuedJob(
    mediaId: string,
    jobKind: string,
    inputChecksums: readonly string[],
  ): Promise<string> {
    const jobId = randomUUID();
    const repository = new KyselyProcessingJobRepository(db);
    const requested = createProcessingJob(
      { id: jobId, mediaId, processorConfigVersion: 'v1', inputChecksums, jobKind },
      NOW,
    );
    await repository.insert(requested);
    await repository.updateState(markProcessingJobQueued(requested, NOW), requested.revision);
    return jobId;
  }

  it('race: an attachment reference blocks deletion with 409 media.referenced and the WHOLE transaction rolls back — record stays available, nothing cancelled, no event', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const mediaId = await completeAndValidate(gardenId, ownerId);
    const clock = fixedClock(NOW);
    const handlers = buildHandlers(clock);
    const plants = buildPlantHandlers(clock);
    const mediaRepository = new KyselyMediaRepository(db);

    const plant = await plants.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      randomUUID(),
    );
    await plants.attachPlantPhoto.execute(plant.id, ownerId, { mediaId }, randomUUID());

    const stillQueuedJobId = await seedQueuedJob(mediaId, MEDIA_DERIVATIVE_GENERATION_JOB_KIND, [
      VALIDATION_CHECKSUM,
    ]);
    const current = await mediaRepository.get(mediaId);

    await expect(
      handlers.deleteGardenMedia.execute(
        gardenId,
        mediaId,
        ownerId,
        current?.revision ?? 0,
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      code: 'media.referenced',
      details: [{ code: 'media.referenced.plant_photo' }],
    });

    // Real rollback: the record is untouched, the queued job survived, no
    // deletion event exists, no audit row was written.
    const after = await mediaRepository.get(mediaId);
    expect(after?.uploadState).toBe('available');
    expect(after?.revision).toBe(current?.revision);
    expect(await new KyselyProcessingJobRepository(db).get(stillQueuedJobId)).toMatchObject({
      state: 'queued',
    });
    const deletionEvents = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', mediaId)
      .where('event_type', '=', MEDIA_DELETION_REQUESTED_EVENT_TYPE)
      .execute();
    expect(deletionEvents).toHaveLength(0);
    const auditRows = await db
      .selectFrom('platform.audit_event')
      .select(['id'])
      .where('subject_id', '=', mediaId)
      .execute();
    expect(auditRows).toHaveLength(0);
  });

  it('race, other ordering: once deletion is scheduled, attaching the media is rejected by the attach-side availability gate', async () => {
    const { gardenId, ownerId } = await createGardenWithOwner();
    const mediaId = await completeAndValidate(gardenId, ownerId);
    const clock = fixedClock(NOW);
    const handlers = buildHandlers(clock);
    const plants = buildPlantHandlers(clock);
    const mediaRepository = new KyselyMediaRepository(db);

    const plant = await plants.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Basil', groupingKind: 'individual' },
      randomUUID(),
    );

    const current = await mediaRepository.get(mediaId);
    await handlers.deleteGardenMedia.execute(
      gardenId,
      mediaId,
      ownerId,
      current?.revision ?? 0,
      randomUUID(),
    );

    await expect(
      plants.attachPlantPhoto.execute(plant.id, ownerId, { mediaId }, randomUUID()),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ code: 'plants_inventory.plant.media_not_available' })],
    });

    const photoRows = await db
      .selectFrom('plants_inventory.plant_photo')
      .select(['id'])
      .where('media_id', '=', mediaId)
      .execute();
    expect(photoRows).toHaveLength(0);
  });
});
