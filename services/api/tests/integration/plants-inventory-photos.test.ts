/**
 * Full-stack integration tests for the plants-inventory module's photo
 * commands against real PostgreSQL/PostGIS — split out of
 * `plants-inventory-photos-identification.test.ts` (itself already split
 * once, per that file's own doc comment) for the same 600-line reason
 * `map-objects.test.ts`/`map-objects-relationships.test.ts` are; the
 * identification/observation/taxonomy-search half stays in
 * `plants-inventory-identification.test.ts`.
 *
 * Covers `AddPlantFromPhoto`, `AttachPlantPhoto`, `SetPrimaryPlantPhoto`, and
 * `ListPlantPhotos`.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { AddPlantFromPhoto } from '../../src/modules/plants-inventory/application/add-plant-from-photo.js';
import { AttachPlantPhoto } from '../../src/modules/plants-inventory/application/attach-plant-photo.js';
import { ListPlantPhotos } from '../../src/modules/plants-inventory/application/list-plant-photos.js';
import { SetPrimaryPlantPhoto } from '../../src/modules/plants-inventory/application/set-primary-plant-photo.js';
import { KyselyPlantPhotoRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-photo-repository.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { KyselyTaxonomyReferenceRepository } from '../../src/modules/plants-inventory/persistence/kysely-taxonomy-reference-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { disabledPlantAiCallPolicies } from '../support/plant-ai-integration-test-doubles.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'plants-inventory photos integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

async function insertProfile(db: Kysely<DatabaseSchema>, id: string): Promise<void> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
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

  async function createGardenWithOwner(now: Date) {
    const ownerId = generateUuidV7();
    await insertProfile(db, ownerId);

    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    return { ownerId, gardenId: garden.id };
  }

  async function registerMedia(ownerId: string, gardenId: string, clock: Clock): Promise<string> {
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const media = await registerMediaRecord.execute(
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'plant.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      generateUuidV7(),
    );
    // Attachment commands now require a same-garden, `available` record
    // (P6-RET-01's attach-versus-delete guard); `RegisterMediaRecord` is the
    // internal garden-less constructor, so this test drives the row to the
    // state a real completed upload reaches directly.
    await db
      .updateTable('media.media_record')
      .set({
        garden_id: gardenId,
        upload_state: 'available',
        // A completed upload always has a stored object behind it; without
        // one, nothing can read the photo the row claims to be.
        bucket_name: 'test-user-media',
        object_key: `gardens/${gardenId}/media/${media.id}`,
      })
      .where('id', '=', media.id)
      .execute();
    return media.id;
  }

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const plantRepository = new KyselyPlantRepository(db);
    const { identifyPlantSpecies, analyzePlantCondition } = disabledPlantAiCallPolicies(db, clock);

    return {
      addPlant: new AddPlant(idempotency, unitOfWork, authorization, clock),
      addPlantFromPhoto: new AddPlantFromPhoto(
        idempotency,
        unitOfWork,
        authorization,
        clock,
        identifyPlantSpecies,
        new KyselyTaxonomyReferenceRepository(db),
        pino({ level: 'silent' }),
        analyzePlantCondition,
      ),
      attachPlantPhoto: new AttachPlantPhoto(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      setPrimaryPlantPhoto: new SetPrimaryPlantPhoto(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
      ),
      listPlantPhotos: new ListPlantPhotos(
        plantRepository,
        new KyselyPlantPhotoRepository(db),
        authorization,
      ),
    };
  }

  it('creates a plant from a photo with one plant_photo and one plant_identification row, taxonomyReferenceId staying null', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const mediaId = await registerMedia(ownerId, gardenId, fixedClock(now));

    const plant = await handlers.addPlantFromPhoto.execute(
      gardenId,
      ownerId,
      { photoMediaId: mediaId },
      generateUuidV7(),
    );

    expect(plant.taxonomyReferenceId).toBeNull();
    expect(plant.groupingKind).toBe('individual');

    const photoRow = await db
      .selectFrom('plants_inventory.plant_photo')
      .selectAll()
      .where('plant_id', '=', plant.id)
      .executeTakeFirstOrThrow();
    expect(photoRow).toMatchObject({ media_id: mediaId, is_primary: true });

    const identificationRow = await db
      .selectFrom('plants_inventory.plant_identification')
      .selectAll()
      .where('plant_id', '=', plant.id)
      .executeTakeFirstOrThrow();
    expect(identificationRow).toMatchObject({
      plant_photo_id: photoRow.id,
      suggested_taxonomy_id: null,
    });
    expect(Number(identificationRow.confidence_score)).toBe(0);
  });

  it('attaches a second photo and moves primary between photos without violating the partial unique index', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const firstMediaId = await registerMedia(ownerId, gardenId, fixedClock(now));
    const secondMediaId = await registerMedia(ownerId, gardenId, fixedClock(now));

    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const firstPhoto = await handlers.attachPlantPhoto.execute(
      plant.id,
      ownerId,
      { mediaId: firstMediaId, isPrimary: true },
      generateUuidV7(),
    );
    const secondPhoto = await handlers.attachPlantPhoto.execute(
      plant.id,
      ownerId,
      { mediaId: secondMediaId, isPrimary: true },
      generateUuidV7(),
    );

    const primaryRows = await db
      .selectFrom('plants_inventory.plant_photo')
      .select(['id', 'is_primary'])
      .where('plant_id', '=', plant.id)
      .where('is_primary', '=', true)
      .execute();
    expect(primaryRows).toEqual([{ id: secondPhoto.id, is_primary: true }]);

    const flipped = await handlers.setPrimaryPlantPhoto.execute(
      plant.id,
      ownerId,
      firstPhoto.id,
      generateUuidV7(),
    );
    expect(flipped.isPrimary).toBe(true);

    const primaryAfterFlip = await db
      .selectFrom('plants_inventory.plant_photo')
      .select(['id'])
      .where('plant_id', '=', plant.id)
      .where('is_primary', '=', true)
      .execute();
    expect(primaryAfterFlip).toEqual([{ id: firstPhoto.id }]);

    // Neither AttachPlantPhoto nor SetPrimaryPlantPhoto bumps plant.revision
    // (see both commands' own doc comments), but each still writes its own
    // sync_change row for the *plant* — a puller must learn its photos
    // changed even though the plant's own revision stayed put. Four
    // sync_change rows total, all at revision 1: addPlant, the two
    // AttachPlantPhoto calls, and the SetPrimaryPlantPhoto flip.
    const syncChangeRows = await db
      .selectFrom('platform.sync_change')
      .select(['record_revision', 'operation'])
      .where('record_id', '=', plant.id)
      .where('record_type', '=', 'plant')
      .orderBy('sequence', 'asc')
      .execute();
    expect(syncChangeRows).toEqual([
      { record_revision: 1, operation: 'upsert' },
      { record_revision: 1, operation: 'upsert' },
      { record_revision: 1, operation: 'upsert' },
      { record_revision: 1, operation: 'upsert' },
    ]);
  });

  it('lists every attached photo, primary first, then oldest first', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const firstMediaId = await registerMedia(ownerId, gardenId, fixedClock(now));
    const secondMediaId = await registerMedia(ownerId, gardenId, fixedClock(now));

    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );
    const firstPhoto = await handlers.attachPlantPhoto.execute(
      plant.id,
      ownerId,
      { mediaId: firstMediaId, isPrimary: false },
      generateUuidV7(),
    );
    const secondPhoto = await handlers.attachPlantPhoto.execute(
      plant.id,
      ownerId,
      { mediaId: secondMediaId, isPrimary: true },
      generateUuidV7(),
    );

    const photos = await handlers.listPlantPhotos.execute(gardenId, plant.id, ownerId);

    expect(photos).toEqual([
      {
        id: secondPhoto.id,
        plantId: plant.id,
        mediaId: secondMediaId,
        isPrimary: true,
        createdAt: now.toISOString(),
      },
      {
        id: firstPhoto.id,
        plantId: plant.id,
        mediaId: firstMediaId,
        isPrimary: false,
        createdAt: now.toISOString(),
      },
    ]);

    const otherPlant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Basil', groupingKind: 'individual' },
      generateUuidV7(),
    );
    await expect(
      handlers.listPlantPhotos.execute(gardenId, otherPlant.id, ownerId),
    ).resolves.toEqual([]);
  });
});
