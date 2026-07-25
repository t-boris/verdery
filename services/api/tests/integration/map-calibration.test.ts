/**
 * P6-PLAN-02 integration coverage for background calibration against a real
 * migrated PostgreSQL database: the reworked `upsertCalibration` command
 * (known distance, control points, manual adjustment → derived transform,
 * residuals, footprint geometry, calibrated details), recalibration as a
 * new transform revision, the calibration-state server-ownership rules, and
 * the geometry lock on calibrated backgrounds. Mirrors
 * `map-imported-background.test.ts`'s structure and drives the SAME shared
 * calibration fixture case the geometry package pins, so the fixture is
 * verified end-to-end through the API's own command path.
 *
 * Source: implementation-plan.md work package P6-PLAN-02;
 *         architecture/map-rendering-and-editing.md, section
 *         "16. Plan Import and Calibration".
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Geometry, UpsertCalibrationPayload } from '@verdery/geometry-contracts';
import { loadFixture, type CalibrationFixture } from '@verdery/test-fixtures';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { ChangeMapObjectProperties } from '../../src/modules/gardens-mapping/application/change-map-object-properties.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { CreateMapObject } from '../../src/modules/gardens-mapping/application/create-map-object.js';
import { DuplicateMapObject } from '../../src/modules/gardens-mapping/application/duplicate-map-object.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { GetMapObject } from '../../src/modules/gardens-mapping/application/get-map-object.js';
import { MoveMapObject } from '../../src/modules/gardens-mapping/application/move-map-object.js';
import { UpsertMapCalibration } from '../../src/modules/gardens-mapping/application/upsert-map-calibration.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMapObjectRepository } from '../../src/modules/gardens-mapping/persistence/kysely-map-object-repository.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import {
  StaleRevisionError,
  ValidationError,
} from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'map calibration integration';
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

const NOW = new Date('2026-07-24T09:00:00Z');

const PLACEHOLDER_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
      [0, 0],
    ],
  ],
};

/** The shared fixture case this suite drives through the real command path. */
const fixture = loadFixture<CalibrationFixture>('geometry/calibration.json');
const foundCase = fixture.cases.find(
  (candidate) => candidate.name === 'two control points recover a quarter-turn rotation exactly',
);
if (foundCase === undefined) {
  throw new Error('Shared calibration fixture case missing.');
}
// A separate const so the narrowed (non-undefined) type survives into the
// test closures below.
const rotationCase = foundCase;

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

  async function createGardenWithOwner() {
    const ownerId = generateUuidV7();
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
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());
    return { ownerId, gardenId: garden.id };
  }

  async function insertPlanMedia(gardenId: string, ownerId: string): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('media.media_record')
      .values({
        id,
        garden_id: gardenId,
        uploaded_by_profile_id: ownerId,
        media_class: 'imported_plan',
        display_filename: 'plan.jpg',
        declared_content_type: 'image/jpeg',
        verified_content_type: 'image/jpeg',
        declared_byte_size: 5_000_000,
        verified_byte_size: 5_000_000,
        bucket_name: 'test-user-media',
        object_key: `ab/${id}/${generateUuidV7()}`,
        upload_state: 'available',
        processing_state: 'processed',
        sensitivity_classification: 'sensitive',
      })
      .execute();
    return id;
  }

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyGardensMappingUnitOfWork(db, clock);

    return {
      createMapObject: new CreateMapObject(idempotency, unitOfWork, authorization, clock),
      changeProperties: new ChangeMapObjectProperties(
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      upsertCalibration: new UpsertMapCalibration(idempotency, unitOfWork, authorization, clock),
      moveMapObject: new MoveMapObject(idempotency, unitOfWork, authorization, clock),
      duplicateMapObject: new DuplicateMapObject(idempotency, unitOfWork, authorization, clock),
      getMapObject: new GetMapObject(new KyselyMapObjectRepository(db), authorization),
    };
  }

  async function createBackground(
    handlers: ReturnType<typeof buildHandlers>,
    gardenId: string,
    ownerId: string,
  ) {
    const planMediaId = await insertPlanMedia(gardenId, ownerId);
    const objectId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId,
        category: 'importedBackground',
        geometry: PLACEHOLDER_POLYGON,
        label: 'Property plan',
        categoryDetails: {
          category: 'importedBackground',
          details: { planMediaId, isBackgroundVisible: true, calibrationState: 'uncalibrated' },
        },
      },
      generateUuidV7(),
    );
    return { objectId, planMediaId };
  }

  function calibrationPayload(
    objectId: string,
    expectedRevision: number,
    overrides: Partial<Omit<UpsertCalibrationPayload, 'type'>> = {},
  ): UpsertCalibrationPayload {
    return {
      type: 'upsertCalibration',
      backgroundObjectId: objectId,
      expectedRevision,
      pageAspectRatio: rotationCase.input.pageAspectRatio,
      knownDistance: rotationCase.input.knownDistance,
      referencePoints: rotationCase.input.referencePoints,
      ...overrides,
    };
  }

  it('calibrates: derives the fixture transform, rewrites details + footprint, and stores the calibration revision', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const handlers = buildHandlers(fixedClock(NOW));
    const { objectId } = await createBackground(handlers, gardenId, ownerId);

    const result = await handlers.upsertCalibration.execute(
      gardenId,
      ownerId,
      calibrationPayload(objectId, 1),
      generateUuidV7(),
    );

    const resource = result.affectedObjects[0];
    expect(resource).toMatchObject({
      revision: 2,
      geometryEnvelope: {
        geometry: { type: 'Polygon', coordinates: [rotationCase.expected.footprint] },
      },
      details: {
        category: 'importedBackground',
        calibrationState: 'calibrated',
        calibration: {
          transformRevision: 1,
          transform: rotationCase.expected.transform,
          rmsErrorMetres: rotationCase.expected.rmsErrorMetres,
        },
      },
    });

    // The read path re-derives the identical block from the stored row.
    const fetched = await handlers.getMapObject.execute(gardenId, objectId, ownerId);
    expect(fetched.details).toMatchObject({
      calibrationState: 'calibrated',
      calibration: {
        transformRevision: 1,
        pageAspectRatio: rotationCase.input.pageAspectRatio,
        knownDistance: rotationCase.input.knownDistance,
        transform: rotationCase.expected.transform,
        rmsErrorMetres: rotationCase.expected.rmsErrorMetres,
      },
    });

    const row = await db
      .selectFrom('gardens_mapping.calibration')
      .select([
        'revision',
        'metres_per_plan_unit',
        'residual_error_metres',
        'point_residuals_metres',
      ])
      .where('background_object_id', '=', objectId)
      .executeTakeFirst();
    expect(row).toMatchObject({
      revision: 1,
      metres_per_plan_unit: rotationCase.expected.transform.metresPerPlanUnit,
      residual_error_metres: rotationCase.expected.rmsErrorMetres,
    });
    expect(row?.point_residuals_metres).toEqual(rotationCase.expected.pointResidualsMetres);
  });

  it('recalibrates as a NEW transform revision, and a stale object revision conflicts', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const handlers = buildHandlers(fixedClock(NOW));
    const { objectId } = await createBackground(handlers, gardenId, ownerId);

    await handlers.upsertCalibration.execute(
      gardenId,
      ownerId,
      calibrationPayload(objectId, 1),
      generateUuidV7(),
    );

    // Same inputs plus a manual translation — the "drag the calibrated
    // background" path the web client takes.
    const recalibrated = await handlers.upsertCalibration.execute(
      gardenId,
      ownerId,
      calibrationPayload(objectId, 2, {
        manualAdjustment: { rotationRadians: 0, translationMetres: { dx: 3, dy: -1 } },
      }),
      generateUuidV7(),
    );
    expect(recalibrated.affectedObjects[0]).toMatchObject({
      revision: 3,
      details: { calibration: { transformRevision: 2 } },
    });

    const revisions = await db
      .selectFrom('gardens_mapping.calibration')
      .select(['revision'])
      .where('background_object_id', '=', objectId)
      .orderBy('revision')
      .execute();
    expect(revisions.map((entry) => entry.revision)).toEqual([1, 2]);

    await expect(
      handlers.upsertCalibration.execute(
        gardenId,
        ownerId,
        calibrationPayload(objectId, 1),
        generateUuidV7(),
      ),
    ).rejects.toThrow(StaleRevisionError);
  });

  it('rejects degenerate inputs and non-background targets', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const handlers = buildHandlers(fixedClock(NOW));
    const { objectId } = await createBackground(handlers, gardenId, ownerId);

    await expect(
      handlers.upsertCalibration.execute(
        gardenId,
        ownerId,
        calibrationPayload(objectId, 1, {
          knownDistance: { pointA: [0.5, 0.5], pointB: [0.5, 0.5], distanceMetres: 10 },
        }),
        generateUuidV7(),
      ),
    ).rejects.toThrow(ValidationError);

    const zoneId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: zoneId,
        category: 'zone',
        geometry: PLACEHOLDER_POLYGON,
        categoryDetails: { category: 'zone', details: { zoneKind: 'lawn' } },
      },
      generateUuidV7(),
    );
    await expect(
      handlers.upsertCalibration.execute(
        gardenId,
        ownerId,
        calibrationPayload(zoneId, 1),
        generateUuidV7(),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('keeps calibration server-owned: state spoofing rejected, visibility toggle preserves the block, geometry commands locked', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const handlers = buildHandlers(fixedClock(NOW));
    const { objectId, planMediaId } = await createBackground(handlers, gardenId, ownerId);

    // createObject cannot claim a calibration that does not exist.
    const spoofedCreate = handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: generateUuidV7(),
        category: 'importedBackground',
        geometry: PLACEHOLDER_POLYGON,
        categoryDetails: {
          category: 'importedBackground',
          details: { planMediaId, isBackgroundVisible: true, calibrationState: 'calibrated' },
        },
      },
      generateUuidV7(),
    );
    await expect(spoofedCreate).rejects.toThrow(ValidationError);

    // changeProperties cannot flip the state in either direction.
    await expect(
      handlers.changeProperties.execute(
        gardenId,
        ownerId,
        {
          type: 'changeProperties',
          objectId,
          expectedRevision: 1,
          categoryDetails: {
            category: 'importedBackground',
            details: { planMediaId, isBackgroundVisible: true, calibrationState: 'calibrated' },
          },
        },
        generateUuidV7(),
      ),
    ).rejects.toThrow(ValidationError);

    await handlers.upsertCalibration.execute(
      gardenId,
      ownerId,
      calibrationPayload(objectId, 1),
      generateUuidV7(),
    );

    // An ordinary visibility toggle (echoing the calibrated state, without
    // the read-only block) keeps the stored calibration attached.
    const toggled = await handlers.changeProperties.execute(
      gardenId,
      ownerId,
      {
        type: 'changeProperties',
        objectId,
        expectedRevision: 2,
        categoryDetails: {
          category: 'importedBackground',
          details: { planMediaId, isBackgroundVisible: false, calibrationState: 'calibrated' },
        },
      },
      generateUuidV7(),
    );
    expect(toggled.affectedObjects[0]?.details).toMatchObject({
      isBackgroundVisible: false,
      calibrationState: 'calibrated',
      calibration: { transformRevision: 1, transform: rotationCase.expected.transform },
    });

    // A calibrated background's placement is its transform — geometry
    // commands are rejected; adjustment goes through recalibration.
    await expect(
      handlers.moveMapObject.execute(
        gardenId,
        ownerId,
        {
          type: 'moveObject',
          objectId,
          expectedRevision: 3,
          translationMetres: { dx: 1, dy: 1 },
        },
        generateUuidV7(),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('duplicating a calibrated background yields an uncalibrated copy — revisions belong to the source', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const handlers = buildHandlers(fixedClock(NOW));
    const { objectId } = await createBackground(handlers, gardenId, ownerId);

    await handlers.upsertCalibration.execute(
      gardenId,
      ownerId,
      calibrationPayload(objectId, 1),
      generateUuidV7(),
    );

    const newObjectId = generateUuidV7();
    const duplicated = await handlers.duplicateMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'duplicateObject',
        sourceObjectId: objectId,
        newObjectId,
        offsetMetres: { dx: 5, dy: 5 },
      },
      generateUuidV7(),
    );

    expect(duplicated.affectedObjects[0]?.details).toMatchObject({
      calibrationState: 'uncalibrated',
    });
    expect(duplicated.affectedObjects[0]?.details).not.toHaveProperty('calibration');

    const fetched = await handlers.getMapObject.execute(gardenId, newObjectId, ownerId);
    expect(fetched.details).toMatchObject({ calibrationState: 'uncalibrated' });
  });
});
