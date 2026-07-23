/**
 * Full-stack integration tests for the observations-history module against
 * real PostgreSQL/PostGIS: real repositories, the real transactional unit of
 * work, and the real idempotency table — not fakes. Mirrors
 * tests/integration/media.test.ts's structure and
 * tests/integration/gardens-mapping.test.ts's rationale for why this must
 * run against a real transaction, not an in-memory fake.
 *
 * Source: implementation-plan.md work package P4-DATA-02;
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
import { CreateMapObject } from '../../src/modules/gardens-mapping/application/create-map-object.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import {
  CorrectObservation,
  type CorrectObservationInput,
} from '../../src/modules/observations-history/application/correct-observation.js';
import { GetObservation } from '../../src/modules/observations-history/application/get-observation.js';
import { ListObservationsForGarden } from '../../src/modules/observations-history/application/list-observations-for-garden.js';
import { ListObservationsForPlant } from '../../src/modules/observations-history/application/list-observations-for-plant.js';
import {
  RecordObservation,
  type RecordObservationInput,
} from '../../src/modules/observations-history/application/record-observation.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { KyselyObservationsHistoryUnitOfWork } from '../../src/modules/observations-history/persistence/kysely-observations-history-unit-of-work.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'observations-history integration';
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

const BASE_INPUT: RecordObservationInput = {
  plantId: null,
  gardenObjectId: null,
  noteText: 'Leaves look healthy.',
  conditionSummary: null,
  observedAt: null,
  photoMediaIds: [],
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

  async function insertProfile(id: string): Promise<void> {
    await db
      .insertInto('identity_access.profile')
      .values({ id, firebase_uid: `firebase-${id}`, account_state: 'active' })
      .execute();
  }

  /** Creates a profile, a garden it owns, and returns everything a test needs to submit commands as that owner. */
  async function createGardenWithOwner(now: Date): Promise<{ ownerId: string; gardenId: string }> {
    const ownerId = generateUuidV7();
    await insertProfile(ownerId);

    const clock = fixedClock(now);
    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Backyard', generateUuidV7());

    return { ownerId, gardenId: garden.id };
  }

  async function createPlant(gardenId: string, ownerId: string, now: Date): Promise<string> {
    const clock = fixedClock(now);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const addPlant = new AddPlant(
      new KyselyIdempotencyStore(db, clock),
      new KyselyPlantsInventoryUnitOfWork(db, clock),
      authorization,
      clock,
    );
    const plant = await addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );
    return plant.id;
  }

  async function createBedObject(gardenId: string, ownerId: string, now: Date): Promise<string> {
    const clock = fixedClock(now);
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
      { type: 'createObject', objectId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );
    return objectId;
  }

  async function createMedia(ownerId: string, now: Date): Promise<string> {
    const clock = fixedClock(now);
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const record = await registerMediaRecord.execute(
      ownerId,
      'gs://verdery-media/leaf.jpg',
      'image/jpeg',
      generateUuidV7(),
    );
    return record.id;
  }

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyObservationsHistoryUnitOfWork(db, clock);
    const observations = new KyselyObservationRepository(db);

    return {
      authorization,
      observations,
      recordObservation: new RecordObservation(idempotency, unitOfWork, authorization, clock),
      correctObservation: new CorrectObservation(
        idempotency,
        unitOfWork,
        authorization,
        observations,
        clock,
      ),
      listObservationsForGarden: new ListObservationsForGarden(observations, authorization),
      listObservationsForPlant: new ListObservationsForPlant(observations, authorization),
      getObservation: new GetObservation(observations),
    };
  }

  it('records a plant-level observation', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const plantId = await createPlant(gardenId, ownerId, now);
    const handlers = buildHandlers(fixedClock(now));

    const resource = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, plantId },
      generateUuidV7(),
    );

    expect(resource).toMatchObject({ gardenId, plantId, gardenObjectId: null, isCorrected: false });
    const row = await db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('id', '=', resource.id)
      .executeTakeFirstOrThrow();
    expect(row.plant_id).toBe(plantId);
    expect(row.actor_type).toBe('user');
  });

  it('records a garden-object (area-level) observation', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const bedId = await createBedObject(gardenId, ownerId, now);
    const handlers = buildHandlers(fixedClock(now));

    const resource = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, gardenObjectId: bedId, noteText: 'Bed is dry.' },
      generateUuidV7(),
    );

    expect(resource).toMatchObject({ plantId: null, gardenObjectId: bedId });
  });

  it('records a note-only observation with no photos', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    const resource = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      BASE_INPUT,
      generateUuidV7(),
    );

    expect(resource.noteText).toBe('Leaves look healthy.');
    expect(resource.photos).toEqual([]);
  });

  it('records a photo-only observation with no note or summary, inserting a photo row and a stubbed, requires-confirmation analysis result', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const mediaId = await createMedia(ownerId, now);
    const handlers = buildHandlers(fixedClock(now));

    const resource = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, noteText: null, photoMediaIds: [mediaId] },
      generateUuidV7(),
    );

    expect(resource.noteText).toBeNull();
    expect(resource.conditionSummary).toBeNull();
    expect(resource.photos).toHaveLength(1);
    expect(resource.photos[0]).toMatchObject({ mediaId });
    expect(resource.photos[0]?.analysisResults).toHaveLength(1);
    expect(resource.photos[0]?.analysisResults[0]).toMatchObject({
      analysisKind: 'other',
      confidenceScore: 0,
      requiresConfirmation: true,
      requestedAdditionalEvidence: true,
    });

    const photoRow = await db
      .selectFrom('observations_history.observation_photo')
      .selectAll()
      .where('observation_id', '=', resource.id)
      .executeTakeFirstOrThrow();
    const analysisRow = await db
      .selectFrom('observations_history.image_analysis_result')
      .selectAll()
      .where('observation_photo_id', '=', photoRow.id)
      .executeTakeFirstOrThrow();
    expect(analysisRow.requires_confirmation).toBe(true);
  });

  it('rejects an observation with no note, no summary, and no photos, writing nothing', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    await expect(
      handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...BASE_INPUT, noteText: null },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const count = await db
      .selectFrom('observations_history.observation')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(0);
  });

  it('rejects a plantId that belongs to a different garden', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const { gardenId: otherGardenId, ownerId: otherOwnerId } = await createGardenWithOwner(now);
    const foreignPlantId = await createPlant(otherGardenId, otherOwnerId, now);
    const handlers = buildHandlers(fixedClock(now));

    await expect(
      handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...BASE_INPUT, plantId: foreignPlantId },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a photoMediaId that does not exist', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    await expect(
      handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...BASE_INPUT, photoMediaIds: [generateUuidV7()] },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a caller who lacks editGardenContent, but still lets that caller list (viewGarden)', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const viewerId = generateUuidV7();
    await insertProfile(viewerId);
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
    await handlers.recordObservation.execute(gardenId, ownerId, BASE_INPUT, generateUuidV7());

    await expect(
      handlers.recordObservation.execute(gardenId, viewerId, BASE_INPUT, generateUuidV7()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      handlers.listObservationsForGarden.execute(gardenId, viewerId),
    ).resolves.toHaveLength(1);
  });

  it('replays the same idempotency key without inserting a second observation, and rejects a reused key with a different body', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const key = generateUuidV7();

    const first = await handlers.recordObservation.execute(gardenId, ownerId, BASE_INPUT, key);
    const replay = await handlers.recordObservation.execute(gardenId, ownerId, BASE_INPUT, key);
    expect(replay).toEqual(first);

    await expect(
      handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...BASE_INPUT, noteText: 'A different note.' },
        key,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const count = await db
      .selectFrom('observations_history.observation')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
  });

  it('corrects an observation with an amendment, leaving the original row in the database completely unchanged', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const laterNow = new Date('2026-07-22T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const original = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      BASE_INPUT,
      generateUuidV7(),
    );

    const originalRowBefore = await db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('id', '=', original.id)
      .executeTakeFirstOrThrow();

    const laterHandlers = buildHandlers(fixedClock(laterNow));
    const correctionInput: CorrectObservationInput = {
      correctionKind: 'amendment',
      noteText: 'Leaves recovered after watering.',
      conditionSummary: null,
      photoMediaIds: [],
    };
    const correction = await laterHandlers.correctObservation.execute(
      original.id,
      ownerId,
      correctionInput,
      generateUuidV7(),
    );

    expect(correction).toMatchObject({
      gardenId,
      correctionKind: 'amendment',
      correctsObservationId: original.id,
      noteText: 'Leaves recovered after watering.',
    });

    const originalRowAfter = await db
      .selectFrom('observations_history.observation')
      .selectAll()
      .where('id', '=', original.id)
      .executeTakeFirstOrThrow();
    expect(originalRowAfter).toEqual(originalRowBefore);
  });

  it('corrects an observation with a supersede, and the original now reports as corrected while the correction itself does not', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const original = await handlers.recordObservation.execute(
      gardenId,
      ownerId,
      BASE_INPUT,
      generateUuidV7(),
    );

    const correctionInput: CorrectObservationInput = {
      correctionKind: 'supersede',
      noteText: 'This was actually a different plant.',
      conditionSummary: null,
      photoMediaIds: [],
    };
    const correction = await handlers.correctObservation.execute(
      original.id,
      ownerId,
      correctionInput,
      generateUuidV7(),
    );

    const history = await handlers.listObservationsForGarden.execute(gardenId, ownerId);
    const originalEntry = history.find((entry) => entry.id === original.id);
    const correctionEntry = history.find((entry) => entry.id === correction.id);
    expect(originalEntry?.isCorrected).toBe(true);
    expect(correctionEntry?.isCorrected).toBe(false);
  });

  it('rejects correcting an observation that does not exist', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    void gardenId;

    const correctionInput: CorrectObservationInput = {
      correctionKind: 'amendment',
      noteText: 'Note.',
      conditionSummary: null,
      photoMediaIds: [],
    };
    await expect(
      handlers.correctObservation.execute(
        generateUuidV7(),
        ownerId,
        correctionInput,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists a plant's observation history, most recently observed first, via GetObservation and ListObservationsForPlant", async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const laterNow = new Date('2026-07-22T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const plantId = await createPlant(gardenId, ownerId, now);

    const first = await buildHandlers(fixedClock(now)).recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, plantId, noteText: 'First note.' },
      generateUuidV7(),
    );
    const second = await buildHandlers(fixedClock(laterNow)).recordObservation.execute(
      gardenId,
      ownerId,
      { ...BASE_INPUT, plantId, noteText: 'Second note.' },
      generateUuidV7(),
    );

    const handlers = buildHandlers(fixedClock(laterNow));
    const history = await handlers.listObservationsForPlant.execute(gardenId, plantId, ownerId);
    expect(history.map((entry) => entry.id)).toEqual([second.id, first.id]);

    await expect(handlers.getObservation.execute(first.id)).resolves.toMatchObject({
      id: first.id,
      gardenId,
    });
    await expect(handlers.getObservation.execute(generateUuidV7())).resolves.toBeNull();
  });
});
