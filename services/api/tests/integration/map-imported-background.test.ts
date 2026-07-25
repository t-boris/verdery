/**
 * P6-PLAN-01 integration coverage for the imported-background flow against a
 * real migrated PostgreSQL database: creating an `importedBackground` object
 * from an available + processed `imported_plan` media record, the plan-media
 * reference validation, the per-background visibility toggle
 * (`changeProperties`), and removal (`deleteObject`) — all through the SAME
 * command handlers every other category already uses, never a parallel
 * command model. Mirrors `map-objects-relationships.test.ts`'s structure.
 *
 * Source: implementation-plan.md work package P6-PLAN-01;
 *         architecture/map-rendering-and-editing.md, section
 *         "16. Plan Import and Calibration".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Geometry, ImportedBackgroundDetails } from '@verdery/geometry-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { ChangeMapObjectProperties } from '../../src/modules/gardens-mapping/application/change-map-object-properties.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { CreateMapObject } from '../../src/modules/gardens-mapping/application/create-map-object.js';
import { DeleteMapObject } from '../../src/modules/gardens-mapping/application/delete-map-object.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { GetMapObject } from '../../src/modules/gardens-mapping/application/get-map-object.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMapObjectRepository } from '../../src/modules/gardens-mapping/persistence/kysely-map-object-repository.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { ValidationError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'imported background integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

const NOW = new Date('2026-07-21T09:00:00Z');

const BACKGROUND_POLYGON: Geometry = {
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

  /** A plan document as the media pipeline leaves it once fully uploaded and validated — the state a background can be created from. */
  async function insertPlanMedia(
    gardenId: string,
    ownerId: string,
    overrides: Partial<{
      media_class: string;
      processing_state: string | null;
      declared_content_type: string;
      verified_content_type: string | null;
    }> = {},
  ): Promise<string> {
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
        ...overrides,
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
      deleteMapObject: new DeleteMapObject(idempotency, unitOfWork, authorization, clock),
      getMapObject: new GetMapObject(new KyselyMapObjectRepository(db), authorization),
    };
  }

  function backgroundDetails(
    planMediaId: string,
    overrides: Partial<ImportedBackgroundDetails> = {},
  ) {
    return {
      category: 'importedBackground' as const,
      details: {
        planMediaId,
        isBackgroundVisible: true,
        calibrationState: 'uncalibrated' as const,
        ...overrides,
      },
    };
  }

  it('creates an imported background from a processed plan, with importedPlan provenance and round-tripped details', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const planMediaId = await insertPlanMedia(gardenId, ownerId);
    const handlers = buildHandlers(fixedClock(NOW));

    const objectId = generateUuidV7();
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId,
        category: 'importedBackground',
        geometry: BACKGROUND_POLYGON,
        label: 'Property plan',
        categoryDetails: backgroundDetails(planMediaId),
      },
      generateUuidV7(),
    );

    expect(created.affectedObjects[0]).toMatchObject({
      category: 'importedBackground',
      geometryEnvelope: { provenance: 'importedPlan' },
      // Flat on the wire, matching openapi.yaml — see
      // map-object-view.ts's toWireGardenObjectDetails.
      details: {
        category: 'importedBackground',
        planMediaId,
        isBackgroundVisible: true,
        calibrationState: 'uncalibrated',
      },
    });

    const fetched = await handlers.getMapObject.execute(gardenId, objectId, ownerId);
    expect(fetched.details).toMatchObject({ planMediaId, calibrationState: 'uncalibrated' });
  });

  it('rejects a background whose plan is missing, unprocessed, not a plan, or in another garden', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const handlers = buildHandlers(fixedClock(NOW));

    const attempt = (planMediaId: string) =>
      handlers.createMapObject.execute(
        gardenId,
        ownerId,
        {
          type: 'createObject',
          objectId: generateUuidV7(),
          category: 'importedBackground',
          geometry: BACKGROUND_POLYGON,
          categoryDetails: backgroundDetails(planMediaId),
        },
        generateUuidV7(),
      );

    await expect(attempt(generateUuidV7())).rejects.toThrow(ValidationError);

    const unprocessed = await insertPlanMedia(gardenId, ownerId, { processing_state: null });
    await expect(attempt(unprocessed)).rejects.toThrow(ValidationError);

    const photo = await insertPlanMedia(gardenId, ownerId, { media_class: 'garden_photo' });
    await expect(attempt(photo)).rejects.toThrow(ValidationError);

    const { ownerId: otherOwnerId, gardenId: otherGardenId } = await createGardenWithOwner();
    const foreignPlan = await insertPlanMedia(otherGardenId, otherOwnerId);
    await expect(attempt(foreignPlan)).rejects.toThrow(ValidationError);
  });

  it('accepts a page selection only for a PDF plan', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const handlers = buildHandlers(fixedClock(NOW));

    const rasterPlan = await insertPlanMedia(gardenId, ownerId);
    await expect(
      handlers.createMapObject.execute(
        gardenId,
        ownerId,
        {
          type: 'createObject',
          objectId: generateUuidV7(),
          category: 'importedBackground',
          geometry: BACKGROUND_POLYGON,
          categoryDetails: backgroundDetails(rasterPlan, { sourcePageNumber: 2 }),
        },
        generateUuidV7(),
      ),
    ).rejects.toThrow(ValidationError);

    const pdfPlan = await insertPlanMedia(gardenId, ownerId, {
      declared_content_type: 'application/pdf',
      verified_content_type: 'application/pdf',
    });
    const created = await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId: generateUuidV7(),
        category: 'importedBackground',
        geometry: BACKGROUND_POLYGON,
        categoryDetails: backgroundDetails(pdfPlan, { sourcePageNumber: 3 }),
      },
      generateUuidV7(),
    );
    expect(created.affectedObjects[0]?.details).toMatchObject({ sourcePageNumber: 3 });
  });

  it('toggles per-background visibility through changeProperties, and removes the background through deleteObject', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const planMediaId = await insertPlanMedia(gardenId, ownerId);
    const handlers = buildHandlers(fixedClock(NOW));

    const objectId = generateUuidV7();
    await handlers.createMapObject.execute(
      gardenId,
      ownerId,
      {
        type: 'createObject',
        objectId,
        category: 'importedBackground',
        geometry: BACKGROUND_POLYGON,
        categoryDetails: backgroundDetails(planMediaId),
      },
      generateUuidV7(),
    );

    const hidden = await handlers.changeProperties.execute(
      gardenId,
      ownerId,
      {
        type: 'changeProperties',
        objectId,
        expectedRevision: 1,
        categoryDetails: backgroundDetails(planMediaId, { isBackgroundVisible: false }),
      },
      generateUuidV7(),
    );
    expect(hidden.affectedObjects[0]?.details).toMatchObject({ isBackgroundVisible: false });

    const row = await db
      .selectFrom('gardens_mapping.imported_background_details')
      .select(['is_background_visible'])
      .where('garden_object_id', '=', objectId)
      .executeTakeFirst();
    expect(row?.is_background_visible).toBe(false);

    const deleted = await handlers.deleteMapObject.execute(
      gardenId,
      ownerId,
      { type: 'deleteObject', objectId, expectedRevision: 2 },
      generateUuidV7(),
    );
    expect(deleted.affectedObjects[0]?.lifecycleState).toBe('deleted');
  });
});
