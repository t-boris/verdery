/**
 * Cross-object reference validation and viewport queries for the garden map
 * — the fence/gate relationship, plant-to-zone/bed assignment, and the
 * viewport bounding box `GetGardenMap` accepts. Split from
 * `map-objects.test.ts` to keep both files under the repository's 600-line
 * source-file limit.
 *
 * Source: implementation-plan.md work packages P3-BE-01, P3-BE-02.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Geometry } from '@verdery/geometry-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { AssignPlantToTarget } from '../../src/modules/gardens-mapping/application/assign-plant-to-target.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { CreateMapObject } from '../../src/modules/gardens-mapping/application/create-map-object.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { GetGardenMap } from '../../src/modules/gardens-mapping/application/get-garden-map.js';
import { KyselyCoordinateSpaceRepository } from '../../src/modules/gardens-mapping/persistence/kysely-coordinate-space-repository.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyGeoreferenceRepository } from '../../src/modules/gardens-mapping/persistence/kysely-georeference-repository.js';
import { KyselyMapObjectRepository } from '../../src/modules/gardens-mapping/persistence/kysely-map-object-repository.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { ValidationError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'garden map relationships and viewport integration';
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

const FENCE_LINE: Geometry = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [10, 0],
  ],
};

const BED_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [1, 1],
      [3, 1],
      [3, 3],
      [1, 3],
      [1, 1],
    ],
  ],
};

const FAR_AWAY_BED_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [500, 500],
      [502, 500],
      [502, 502],
      [500, 502],
      [500, 500],
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

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyGardensMappingUnitOfWork(db, clock);

    return {
      createMapObject: new CreateMapObject(idempotency, unitOfWork, authorization, clock),
      assignPlantToTarget: new AssignPlantToTarget(idempotency, unitOfWork, authorization, clock),
      getGardenMap: new GetGardenMap(
        authorization,
        new KyselyCoordinateSpaceRepository(db),
        new KyselyGeoreferenceRepository(db),
        new KyselyMapObjectRepository(db),
        clock,
      ),
    };
  }

  it('creates a fence, then a gate referencing it', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const fenceId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: fenceId,
        category: 'fence',
        geometry: FENCE_LINE,
        categoryDetails: { category: 'fence', details: { fenceKind: 'wood' } },
      },
      generateUuidV7(),
    );

    const gate = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: generateUuidV7(),
        category: 'gate',
        geometry: { type: 'Point', coordinates: [5, 0] },
        categoryDetails: {
          category: 'gate',
          details: { fenceObjectId: fenceId, widthMetres: 1.2 },
        },
      },
      generateUuidV7(),
    );

    expect(gate.affectedObjects[0]).toMatchObject({
      category: 'gate',
      // Flat on the wire, matching openapi.yaml — see
      // map-object-view.ts's toWireGardenObjectDetails.
      details: { category: 'gate', fenceObjectId: fenceId, widthMetres: 1.2 },
    });
  });

  it('rejects a gate referencing a nonexistent fence', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    await expect(
      handlers.createMapObject.execute(
        gardenId,
        ownerId,
        {
          type: 'createObject',
          objectId: generateUuidV7(),
          category: 'gate',
          geometry: { type: 'Point', coordinates: [5, 0] },
          categoryDetails: { category: 'gate', details: { fenceObjectId: generateUuidV7() } },
        },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a gate referencing an object that exists but is not a fence', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const bedId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: bedId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );

    await expect(
      handlers.createMapObject.execute(
        gardenId,
        ownerId,
        {
          type: 'createObject',
          objectId: generateUuidV7(),
          category: 'gate',
          geometry: { type: 'Point', coordinates: [5, 0] },
          categoryDetails: { category: 'gate', details: { fenceObjectId: bedId } },
        },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('assigns a plant to a bed, and rejects assigning it to a non-zone/bed target', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const bedId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: bedId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );

    const plantId = generateUuidV7();
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: plantId,
        category: 'plant',
        geometry: { type: 'Point', coordinates: [2, 2] },
        categoryDetails: { category: 'plant', details: { commonName: 'Tomato', quantity: 3 } },
      },
      generateUuidV7(),
    );
    const created0 = created.affectedObjects[0];
    if (created0 === undefined) throw new Error('expected an affected object');

    const assigned = await handlers.assignPlantToTarget.execute(
      gardenId,
      ownerId,
      {
        type: 'assignPlant',
        plantObjectId: plantId,
        expectedRevision: created0.revision,
        targetObjectId: bedId,
      },
      generateUuidV7(),
    );
    const assigned0 = assigned.affectedObjects[0];
    if (assigned0 === undefined) throw new Error('expected an affected object');
    expect(assigned0.details).toMatchObject({
      category: 'plant',
      // Flat on the wire, matching openapi.yaml — see
      // map-object-view.ts's toWireGardenObjectDetails.
      commonName: 'Tomato',
      quantity: 3,
      assignedToObjectId: bedId,
    });

    const unassigned = await handlers.assignPlantToTarget.execute(
      gardenId,
      ownerId,
      {
        type: 'assignPlant',
        plantObjectId: plantId,
        expectedRevision: assigned0.revision,
        targetObjectId: null,
      },
      generateUuidV7(),
    );
    const unassignedDetails = unassigned.affectedObjects[0]?.details;
    expect(
      unassignedDetails?.['category'] === 'plant' && unassignedDetails['assignedToObjectId'],
    ).toBeUndefined();

    // A fence is neither a zone nor a bed — an invalid assignment target.
    const fenceId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: fenceId, category: 'fence', geometry: FENCE_LINE },
      generateUuidV7(),
    );
    await expect(
      handlers.assignPlantToTarget.execute(
        gardenId,
        ownerId,
        {
          type: 'assignPlant',
          plantObjectId: plantId,
          expectedRevision: unassigned.affectedObjects[0]?.revision ?? 0,
          targetObjectId: fenceId,
        },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("excludes an out-of-bounds object from the map query's viewport bounding box", async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const nearBedId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: nearBedId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );

    const farBedId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: farBedId, category: 'bed', geometry: FAR_AWAY_BED_POLYGON },
      generateUuidV7(),
    );

    const wholeGardenDocument = await handlers.getGardenMap.execute(gardenId, ownerId, null);
    expect(wholeGardenDocument.objects.map((object) => object.id).sort()).toEqual(
      [nearBedId, farBedId].sort(),
    );

    const viewportDocument = await handlers.getGardenMap.execute(gardenId, ownerId, {
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    });
    const viewportIds = viewportDocument.objects.map((object) => object.id);
    expect(viewportIds).toContain(nearBedId);
    expect(viewportIds).not.toContain(farBedId);
  });
});
