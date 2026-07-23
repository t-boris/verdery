/**
 * Full-stack integration tests for the plants-inventory module's core plant
 * lifecycle against real PostgreSQL/PostGIS: real repositories, the real
 * transactional unit of work, the real revision journal — not fakes.
 * Mirrors the rigor of `tests/integration/gardens-mapping.test.ts` and
 * `tests/integration/media.test.ts`.
 *
 * Covers `AddPlant`, `UpdatePlantDetails`, `TransitionPlantLifecycleStage`,
 * `SetPlantStatus`, and `MovePlant`, plus authorization and idempotency.
 * `AddPlantFromPhoto`, `AttachPlantPhoto`, `SetPrimaryPlantPhoto`,
 * `ConfirmPlantIdentification`, and `SearchTaxonomyReferences` live in the
 * sibling file `plants-inventory-photos-identification.test.ts` — split so
 * neither file approaches the repository's 600-line source-file limit, the
 * same reason `map-objects.test.ts`/`map-objects-relationships.test.ts` are
 * split.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Geometry } from '@verdery/geometry-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { CreateMapObject } from '../../src/modules/gardens-mapping/application/create-map-object.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { MovePlant } from '../../src/modules/plants-inventory/application/move-plant.js';
import { SetPlantStatus } from '../../src/modules/plants-inventory/application/set-plant-status.js';
import { TransitionPlantLifecycleStage } from '../../src/modules/plants-inventory/application/transition-plant-lifecycle-stage.js';
import { UpdatePlantDetails } from '../../src/modules/plants-inventory/application/update-plant-details.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleRevisionError,
  ValidationError,
} from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'plants-inventory integration';
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

async function insertProfile(db: Kysely<DatabaseSchema>, id: string): Promise<void> {
  await db
    .insertInto('identity_access.profile')
    .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
    .execute();
}

const LOT_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
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
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  /** Creates a profile, a garden it owns, and returns everything a test needs to submit plant commands as that owner. */
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

  /** Creates a plain `lot` garden object (no category-specific details) — a stand-in "garden area" for placement tests. */
  async function createLot(gardenId: string, ownerId: string, clock: Clock): Promise<string> {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const createMapObject = new CreateMapObject(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      authorization,
      clock,
    );
    const objectId = generateUuidV7();
    await createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId, category: 'lot', geometry: LOT_POLYGON },
      generateUuidV7(),
    );
    return objectId;
  }

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const plantRepository = new KyselyPlantRepository(db);

    return {
      authorization,
      plantRepository,
      addPlant: new AddPlant(idempotency, unitOfWork, authorization, clock),
      updatePlantDetails: new UpdatePlantDetails(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      transitionPlantLifecycleStage: new TransitionPlantLifecycleStage(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      setPlantStatus: new SetPlantStatus(
        plantRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      movePlant: new MovePlant(plantRepository, idempotency, unitOfWork, authorization, clock),
    };
  }

  it('creates a plant with a placement, journals it, and rejects a placement in a different garden', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const otherGarden = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const lotId = await createLot(gardenId, ownerId, fixedClock(now));
    const foreignLotId = await createLot(
      otherGarden.gardenId,
      otherGarden.ownerId,
      fixedClock(now),
    );

    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual', gardenAreaMapObjectId: lotId },
      generateUuidV7(),
    );

    expect(plant).toMatchObject({
      gardenId,
      displayName: 'Tomato',
      gardenAreaMapObjectId: lotId,
      groupingKind: 'individual',
      lifecycleStage: 'planned',
      status: 'active',
      revision: 1,
    });

    const revisionRow = await db
      .selectFrom('plants_inventory.plant_revision')
      .selectAll()
      .where('plant_id', '=', plant.id)
      .executeTakeFirst();
    expect(revisionRow).toMatchObject({
      revision: 1,
      command_type: 'addPlant',
      lifecycle_stage: 'planned',
      status: 'active',
    });

    await expect(
      handlers.addPlant.execute(
        gardenId,
        ownerId,
        {
          displayName: 'Carrot',
          groupingKind: 'row',
          quantity: 6,
          placementMapObjectId: foreignLotId,
        },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a quantity/groupingKind invariant violation and an unauthorized caller', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const viewerId = generateUuidV7();
    await insertProfile(db, viewerId);
    await db
      .insertInto('collaboration.membership')
      .values({
        id: generateUuidV7(),
        garden_id: gardenId,
        profile_id: viewerId,
        role: 'viewer',
        state: 'active',
      })
      .execute();
    const handlers = buildHandlers(fixedClock(now));

    await expect(
      handlers.addPlant.execute(
        gardenId,
        ownerId,
        { displayName: 'Carrots', groupingKind: 'row' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      handlers.addPlant.execute(
        gardenId,
        viewerId,
        { displayName: 'Tomato', groupingKind: 'individual' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await expect(
      handlers.addPlant.execute(
        gardenId,
        generateUuidV7(),
        { displayName: 'Tomato', groupingKind: 'individual' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('replays the same idempotency key without creating a second plant, and rejects a reused key with a different body', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const key = generateUuidV7();

    const first = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      key,
    );
    const replay = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      key,
    );
    expect(replay).toEqual(first);

    await expect(
      handlers.addPlant.execute(
        gardenId,
        ownerId,
        { displayName: 'Basil', groupingKind: 'individual' },
        key,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const plantCount = await db
      .selectFrom('plants_inventory.plant')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(plantCount.count)).toBe(1);
  });

  it('updates details with a revision guard, including clearing taxonomyReferenceId', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const later = new Date('2026-07-21T10:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(later));
    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual', acquisitionDate: '2026-05-01' },
      generateUuidV7(),
    );
    expect(plant.acquisitionDate).toBe('2026-05-01');

    await expect(
      handlers.updatePlantDetails.execute(
        plant.id,
        ownerId,
        999,
        { displayName: 'Roma Tomato' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    const updated = await handlers.updatePlantDetails.execute(
      plant.id,
      ownerId,
      plant.revision,
      { displayName: 'Roma Tomato', taxonomyReferenceId: null, conditionNote: 'Healthy' },
      generateUuidV7(),
    );

    expect(updated).toMatchObject({
      displayName: 'Roma Tomato',
      taxonomyReferenceId: null,
      conditionNote: 'Healthy',
      revision: 2,
    });
  });

  it('transitions lifecycle stage and status independently, journaling only the changed field each time', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const flowering = await handlers.transitionPlantLifecycleStage.execute(
      plant.id,
      ownerId,
      plant.revision,
      'flowering',
      generateUuidV7(),
    );
    expect(flowering).toMatchObject({ lifecycleStage: 'flowering', status: 'active', revision: 2 });

    const dormant = await handlers.setPlantStatus.execute(
      plant.id,
      ownerId,
      flowering.revision,
      'dormant',
      generateUuidV7(),
    );
    expect(dormant).toMatchObject({ lifecycleStage: 'flowering', status: 'dormant', revision: 3 });

    const rows = await db
      .selectFrom('plants_inventory.plant_revision')
      .select(['command_type', 'lifecycle_stage', 'status'])
      .where('plant_id', '=', plant.id)
      .orderBy('revision', 'asc')
      .execute();
    expect(rows).toEqual([
      { command_type: 'addPlant', lifecycle_stage: 'planned', status: 'active' },
      { command_type: 'transitionLifecycleStage', lifecycle_stage: 'flowering', status: null },
      { command_type: 'setStatus', lifecycle_stage: null, status: 'dormant' },
    ]);
  });

  it('removes a plant by transitioning status, modeling delete without a hard-delete command', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const removed = await handlers.setPlantStatus.execute(
      plant.id,
      ownerId,
      plant.revision,
      'removed',
      generateUuidV7(),
    );
    expect(removed.status).toBe('removed');

    const stillExists = await db
      .selectFrom('plants_inventory.plant')
      .selectAll()
      .where('id', '=', plant.id)
      .executeTakeFirst();
    expect(stillExists).toBeDefined();
  });

  it('moves a plant within its own garden and rejects a target from a different garden', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const otherGarden = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const lotId = await createLot(gardenId, ownerId, fixedClock(now));
    const foreignLotId = await createLot(
      otherGarden.gardenId,
      otherGarden.ownerId,
      fixedClock(now),
    );
    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const moved = await handlers.movePlant.execute(
      plant.id,
      ownerId,
      plant.revision,
      { placementMapObjectId: lotId },
      generateUuidV7(),
    );
    expect(moved).toMatchObject({ placementMapObjectId: lotId, gardenId, revision: 2 });

    await expect(
      handlers.movePlant.execute(
        plant.id,
        ownerId,
        moved.revision,
        { placementMapObjectId: foreignLotId },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
