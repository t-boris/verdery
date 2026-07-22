/**
 * Full-stack integration tests for the garden map's object lifecycle
 * commands against real PostgreSQL/PostGIS: real repositories, the real
 * transactional unit of work, real revision-journal and outbox rows — not
 * fakes. Mirrors the rigor of `tests/integration/gardens-mapping.test.ts`.
 *
 * Fence/gate, plant assignment, and viewport queries live in the sibling
 * file `map-objects-relationships.test.ts` — split so neither file
 * approaches the repository's 600-line source-file limit.
 *
 * Source: implementation-plan.md work packages P3-BE-01, P3-BE-02;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Geometry } from '@verdery/geometry-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { ChangeMapObjectProperties } from '../../src/modules/gardens-mapping/application/change-map-object-properties.js';
import { CreateMapObject } from '../../src/modules/gardens-mapping/application/create-map-object.js';
import { DeleteMapObject } from '../../src/modules/gardens-mapping/application/delete-map-object.js';
import { EditMapObjectVertex } from '../../src/modules/gardens-mapping/application/edit-map-object-vertex.js';
import { MoveMapObject } from '../../src/modules/gardens-mapping/application/move-map-object.js';
import { ReplaceMapObjectGeometry } from '../../src/modules/gardens-mapping/application/replace-map-object-geometry.js';
import { RestoreMapObject } from '../../src/modules/gardens-mapping/application/restore-map-object.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { ForbiddenError, StaleRevisionError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'garden map object lifecycle integration';
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

  /** Creates a profile, a garden it owns, and returns everything a test needs to submit map commands as that owner. */
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
      authorization,
      createMapObject: new CreateMapObject(idempotency, unitOfWork, authorization, clock),
      moveMapObject: new MoveMapObject(idempotency, unitOfWork, authorization, clock),
      replaceMapObjectGeometry: new ReplaceMapObjectGeometry(
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      editMapObjectVertex: new EditMapObjectVertex(idempotency, unitOfWork, authorization, clock),
      changeMapObjectProperties: new ChangeMapObjectProperties(
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      deleteMapObject: new DeleteMapObject(idempotency, unitOfWork, authorization, clock),
      restoreMapObject: new RestoreMapObject(idempotency, unitOfWork, authorization, clock),
    };
  }

  it('creates a lot, then a bed inside it, each with a revision-journal row, a sync-change row, and an outbox event', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const lotId = generateUuidV7();
    const lot = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: lotId, category: 'lot', geometry: LOT_POLYGON },
      generateUuidV7(),
    );
    expect(lot.affectedObjects[0]).toMatchObject({
      category: 'lot',
      revision: 1,
      lifecycleState: 'active',
    });

    const bedId = generateUuidV7();
    const bed = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: bedId,
        category: 'bed',
        geometry: BED_POLYGON,
        label: 'Tomato bed',
        categoryDetails: { category: 'bed', details: { bedKind: 'raised' } },
      },
      generateUuidV7(),
    );
    expect(bed.affectedObjects[0]).toMatchObject({
      category: 'bed',
      label: 'Tomato bed',
      revision: 1,
      details: { category: 'bed', details: { bedKind: 'raised' } },
    });

    const revisionRow = await db
      .selectFrom('gardens_mapping.garden_object_revision')
      .selectAll()
      .where('garden_object_id', '=', bedId)
      .executeTakeFirst();
    expect(revisionRow).toMatchObject({ revision: 1, command_type: 'createObject' });

    const syncChangeRow = await db
      .selectFrom('platform.sync_change')
      .selectAll()
      .where('record_id', '=', bedId)
      .executeTakeFirst();
    expect(syncChangeRow).toMatchObject({
      operation: 'upsert',
      record_revision: 1,
      garden_id: gardenId,
    });

    const outboxRow = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', bedId)
      .where('event_type', '=', 'mapObject.created')
      .executeTakeFirst();
    expect(outboxRow).toBeDefined();

    const auditRow = await db
      .selectFrom('platform.audit_event')
      .selectAll()
      .where('subject_id', '=', bedId)
      .where('event_type', '=', 'mapObject.created')
      .executeTakeFirst();
    expect(auditRow).toBeDefined();
  });

  it('moves, replaces the geometry of, and edits a vertex of a bed, each bumping its revision', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const bedId = generateUuidV7();
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: bedId,
        category: 'bed',
        geometry: BED_POLYGON,
        categoryDetails: { category: 'bed', details: { bedKind: 'inGround' } },
      },
      generateUuidV7(),
    );
    const created0 = created.affectedObjects[0];
    if (created0 === undefined) throw new Error('expected an affected object');

    const moved = await handlers.moveMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'moveObject',
        objectId: bedId,
        expectedRevision: created0.revision,
        translationMetres: { dx: 5, dy: 0 },
      },
      generateUuidV7(),
    );
    const moved0 = moved.affectedObjects[0];
    if (moved0 === undefined) throw new Error('expected an affected object');
    expect(moved0.revision).toBe(2);
    expect(moved0.geometryEnvelope.geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [6, 1],
          [8, 1],
          [8, 3],
          [6, 3],
          [6, 1],
        ],
      ],
    });

    const replacementGeometry: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [20, 20],
          [25, 20],
          [25, 25],
          [20, 25],
          [20, 20],
        ],
      ],
    };
    const replaced = await handlers.replaceMapObjectGeometry.execute(
      gardenId,
      ownerId,
      {
        type: 'replaceGeometry',
        objectId: bedId,
        expectedRevision: moved0.revision,
        geometry: replacementGeometry,
      },
      generateUuidV7(),
    );
    const replaced0 = replaced.affectedObjects[0];
    if (replaced0 === undefined) throw new Error('expected an affected object');
    expect(replaced0.revision).toBe(3);
    expect(replaced0.geometryEnvelope.geometry).toEqual(replacementGeometry);

    // Vertex index 2 (an interior ring vertex, not the closing vertex shared
    // with index 0) — moving the closing vertex itself would break the
    // ring's closure, a documented limitation of this pass's vertex editor;
    // see the doc comment on `domain/geometry-edit.ts`.
    const edited = await handlers.editMapObjectVertex.execute(
      gardenId,
      ownerId,
      {
        type: 'editVertex',
        objectId: bedId,
        expectedRevision: replaced0.revision,
        operation: 'move',
        ringIndex: 0,
        vertexIndex: 2,
        position: [30, 30],
      },
      generateUuidV7(),
    );
    const edited0 = edited.affectedObjects[0];
    if (edited0 === undefined) throw new Error('expected an affected object');
    expect(edited0.revision).toBe(4);
    const editedGeometry = edited0.geometryEnvelope.geometry;
    if (editedGeometry.type !== 'Polygon') throw new Error('expected a Polygon geometry');
    expect(editedGeometry.coordinates[0]?.[2]).toEqual([30, 30]);

    const revisionRows = await db
      .selectFrom('gardens_mapping.garden_object_revision')
      .select('revision')
      .where('garden_object_id', '=', bedId)
      .orderBy('revision')
      .execute();
    expect(revisionRows.map((row) => row.revision)).toEqual([1, 2, 3, 4]);
  });

  it('changes a bed label and category details without touching its geometry', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const bedId = generateUuidV7();
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: bedId,
        category: 'bed',
        geometry: BED_POLYGON,
        label: 'Bed 1',
        categoryDetails: { category: 'bed', details: { bedKind: 'inGround' } },
      },
      generateUuidV7(),
    );
    const created0 = created.affectedObjects[0];
    if (created0 === undefined) throw new Error('expected an affected object');

    const changed = await handlers.changeMapObjectProperties.execute(
      gardenId,
      ownerId,
      {
        type: 'changeProperties',
        objectId: bedId,
        expectedRevision: created0.revision,
        label: 'Tomatoes and basil',
        categoryDetails: {
          category: 'bed',
          details: { bedKind: 'raised', soilNotes: 'Amended with compost' },
        },
      },
      generateUuidV7(),
    );
    const changed0 = changed.affectedObjects[0];
    if (changed0 === undefined) throw new Error('expected an affected object');

    expect(changed0.label).toBe('Tomatoes and basil');
    expect(changed0.details).toEqual({
      category: 'bed',
      details: { bedKind: 'raised', soilNotes: 'Amended with compost' },
    });
    expect(changed0.geometryEnvelope.geometry).toEqual(BED_POLYGON);
  });

  it('deletes and then restores a bed', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const bedId = generateUuidV7();
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: bedId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );
    const created0 = created.affectedObjects[0];
    if (created0 === undefined) throw new Error('expected an affected object');

    const deleted = await handlers.deleteMapObject.execute(
      gardenId,
      ownerId,
      { type: 'deleteObject', objectId: bedId, expectedRevision: created0.revision },
      generateUuidV7(),
    );
    const deleted0 = deleted.affectedObjects[0];
    if (deleted0 === undefined) throw new Error('expected an affected object');
    expect(deleted0.lifecycleState).toBe('deleted');

    const syncDeleteRow = await db
      .selectFrom('platform.sync_change')
      .selectAll()
      .where('record_id', '=', bedId)
      .where('operation', '=', 'delete')
      .executeTakeFirst();
    expect(syncDeleteRow).toBeDefined();

    const restored = await handlers.restoreMapObject.execute(
      gardenId,
      ownerId,
      { type: 'restoreObject', objectId: bedId, expectedRevision: deleted0.revision },
      generateUuidV7(),
    );
    const restored0 = restored.affectedObjects[0];
    if (restored0 === undefined) throw new Error('expected an affected object');
    expect(restored0.lifecycleState).toBe('active');
    expect(restored0.revision).toBe(deleted0.revision + 1);
  });

  it('rejects a stale expectedRevision and applies a correct one', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const bedId = generateUuidV7();
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: bedId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );
    const created0 = created.affectedObjects[0];
    if (created0 === undefined) throw new Error('expected an affected object');

    await expect(
      handlers.moveMapObject.execute(
        gardenId,
        ownerId,
        {
          type: 'moveObject',
          objectId: bedId,
          expectedRevision: 999,
          translationMetres: { dx: 1, dy: 1 },
        },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    const moved = await handlers.moveMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'moveObject',
        objectId: bedId,
        expectedRevision: created0.revision,
        translationMetres: { dx: 1, dy: 1 },
      },
      generateUuidV7(),
    );
    expect(moved.affectedObjects[0]?.revision).toBe(2);
  });

  it('lets an owner mutate map content but rejects a viewer with Forbidden, while still letting the viewer read the map', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

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

    await expect(
      handlers.createMapObject.execute(
        gardenId,
        viewerId,
        {
          type: 'createObject',
          objectId: generateUuidV7(),
          category: 'lot',
          geometry: LOT_POLYGON,
        },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // A viewer keeps read access, even though they cannot mutate.
    const membership = await handlers.authorization.requireCapability(
      gardenId,
      viewerId,
      'viewGarden',
    );
    expect(membership.role).toBe('viewer');

    // The owner, meanwhile, succeeds at the same mutation.
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: generateUuidV7(), category: 'lot', geometry: LOT_POLYGON },
      generateUuidV7(),
    );
    expect(created.affectedObjects[0]).toMatchObject({ category: 'lot' });
  });

  it("reuses a garden's coordinate space across multiple createObject commands", async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const first = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: generateUuidV7(), category: 'lot', geometry: LOT_POLYGON },
      generateUuidV7(),
    );
    const second = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: generateUuidV7(), category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );

    expect(first.affectedObjects[0]?.geometryEnvelope.coordinateSpaceId).toBe(
      second.affectedObjects[0]?.geometryEnvelope.coordinateSpaceId,
    );

    const coordinateSpaceCount = await db
      .selectFrom('gardens_mapping.coordinate_space')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(coordinateSpaceCount.count)).toBe(1);
  });
});
