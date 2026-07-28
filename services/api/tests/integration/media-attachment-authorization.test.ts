/**
 * P6-QA-01's cross-garden ATTACH deny evidence, against real PostgreSQL:
 * every command that references a media id — `AttachPlantPhoto`,
 * `AddPlantFromPhoto`, `RecordObservation` (photoMediaIds), and
 * `AttachTaskFile` — must reject BOTH a media record belonging to a
 * different garden (P6-RET-01's "would let a stranger's row pin media they
 * cannot read" fix) and a record that never reached `available`. Stage 11
 * added the four guards and proved the plants guard once, through the
 * delete-versus-attach race suite; nothing exercised the cross-garden half
 * of ANY of them, nor the other three commands' availability half, until
 * this file. Lives as its own suite (rather than three per-module
 * additions) because the observations and tasks suites both sit within a
 * few lines of the repository's 600-line file rule.
 *
 * Source: architecture/media-storage-and-processing.md, sections
 * "16.1 Implemented deletion profile" (the attach-side guard) and
 * "20. Testing" ("Unauthorized cross-garden access").
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
import { GetObservation } from '../../src/modules/observations-history/application/get-observation.js';
import { RecordObservation } from '../../src/modules/observations-history/application/record-observation.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { KyselyObservationsHistoryUnitOfWork } from '../../src/modules/observations-history/persistence/kysely-observations-history-unit-of-work.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { AddPlantFromPhoto } from '../../src/modules/plants-inventory/application/add-plant-from-photo.js';
import { AttachPlantPhoto } from '../../src/modules/plants-inventory/application/attach-plant-photo.js';
import { KyselyPlantRepository } from '../../src/modules/plants-inventory/persistence/kysely-plant-repository.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { KyselyTaxonomyReferenceRepository } from '../../src/modules/plants-inventory/persistence/kysely-taxonomy-reference-repository.js';
import { AttachTaskFile } from '../../src/modules/tasks-recommendations/application/attach-task-file.js';
import { CreateManualTask } from '../../src/modules/tasks-recommendations/application/create-manual-task.js';
import { KyselyTaskRepository } from '../../src/modules/tasks-recommendations/persistence/kysely-task-repository.js';
import { KyselyTasksRecommendationsUnitOfWork } from '../../src/modules/tasks-recommendations/persistence/kysely-tasks-recommendations-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { disabledPlantAiCallPolicies } from '../support/plant-ai-integration-test-doubles.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'media attachment authorization integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const NOW = new Date('2026-07-24T09:00:00Z');

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

  /**
   * A media row in `gardenId` at `uploadState` — the same
   * `RegisterMediaRecord`-then-drive-the-row shape every attach suite's own
   * helper documents.
   */
  async function registerMedia(
    ownerId: string,
    gardenId: string,
    uploadState: 'available' | 'registered',
  ): Promise<string> {
    const clock = fixedClock(NOW);
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const media = await registerMediaRecord.execute(
      ownerId,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'photo.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      generateUuidV7(),
    );
    await db
      .updateTable('media.media_record')
      .set({ garden_id: gardenId, upload_state: uploadState })
      .where('id', '=', media.id)
      .execute();
    return media.id;
  }

  function buildHandlers() {
    const clock = fixedClock(NOW);
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const plantRepository = new KyselyPlantRepository(db);
    const plantsUnitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const taskRepository = new KyselyTaskRepository(db);
    const { identifyPlantSpecies, analyzePlantCondition } = disabledPlantAiCallPolicies(db, clock);

    return {
      addPlant: new AddPlant(idempotency, plantsUnitOfWork, authorization, clock),
      addPlantFromPhoto: new AddPlantFromPhoto(
        idempotency,
        plantsUnitOfWork,
        authorization,
        clock,
        identifyPlantSpecies,
        new KyselyTaxonomyReferenceRepository(db),
        pino({ level: 'silent' }),
      ),
      attachPlantPhoto: new AttachPlantPhoto(
        plantRepository,
        idempotency,
        plantsUnitOfWork,
        authorization,
        clock,
      ),
      recordObservation: new RecordObservation(
        idempotency,
        new KyselyObservationsHistoryUnitOfWork(db, clock),
        authorization,
        clock,
        analyzePlantCondition,
      ),
      createManualTask: new CreateManualTask(
        idempotency,
        new KyselyTasksRecommendationsUnitOfWork(db, clock),
        authorization,
        new GetObservation(new KyselyObservationRepository(db)),
        clock,
      ),
      attachTaskFile: new AttachTaskFile(
        taskRepository,
        idempotency,
        new KyselyTasksRecommendationsUnitOfWork(db, clock),
        authorization,
        clock,
      ),
    };
  }

  it('AttachPlantPhoto and AddPlantFromPhoto reject another garden`s media and a non-available record, inserting nothing', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const foreign = await createGardenWithOwner();
    const handlers = buildHandlers();

    const plant = await handlers.addPlant.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );

    const foreignMediaId = await registerMedia(foreign.ownerId, foreign.gardenId, 'available');
    const unavailableMediaId = await registerMedia(ownerId, gardenId, 'registered');

    await expect(
      handlers.attachPlantPhoto.execute(
        plant.id,
        ownerId,
        { mediaId: foreignMediaId },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({ code: 'plants_inventory.plant.invalid_media_reference' }),
      ],
    });

    await expect(
      handlers.attachPlantPhoto.execute(
        plant.id,
        ownerId,
        { mediaId: unavailableMediaId },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ code: 'plants_inventory.plant.media_not_available' })],
    });

    await expect(
      handlers.addPlantFromPhoto.execute(
        gardenId,
        ownerId,
        { photoMediaId: foreignMediaId },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({ code: 'plants_inventory.plant.invalid_media_reference' }),
      ],
    });

    const photoRows = await db
      .selectFrom('plants_inventory.plant_photo')
      .select(db.fn.countAll().as('count'))
      .where('plant_id', '=', plant.id)
      .executeTakeFirstOrThrow();
    expect(Number(photoRows.count)).toBe(0);
  });

  it('RecordObservation rejects another garden`s media and a non-available record in photoMediaIds, and the whole observation rolls back', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const foreign = await createGardenWithOwner();
    const handlers = buildHandlers();

    const foreignMediaId = await registerMedia(foreign.ownerId, foreign.gardenId, 'available');
    const unavailableMediaId = await registerMedia(ownerId, gardenId, 'registered');

    const baseInput = {
      plantId: null,
      gardenObjectId: null,
      noteText: 'Leaves look healthy.',
      conditionSummary: null,
      observedAt: null,
    };

    await expect(
      handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...baseInput, photoMediaIds: [foreignMediaId] },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ code: 'observation.photo_media_not_found' })],
    });

    await expect(
      handlers.recordObservation.execute(
        gardenId,
        ownerId,
        { ...baseInput, photoMediaIds: [unavailableMediaId] },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({
      details: [expect.objectContaining({ code: 'observation.photo_media_not_available' })],
    });

    // The rejection rolled back the observation row itself, not only the
    // photo insert — a real-transaction guarantee a fake unit of work
    // cannot prove.
    const observationRows = await db
      .selectFrom('observations_history.observation')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(observationRows.count)).toBe(0);
  });

  it('AttachTaskFile rejects another garden`s media and a non-available record, inserting nothing', async () => {
    const { ownerId, gardenId } = await createGardenWithOwner();
    const foreign = await createGardenWithOwner();
    const handlers = buildHandlers();

    const task = await handlers.createManualTask.execute(
      gardenId,
      ownerId,
      { target: { kind: 'garden' }, title: 'Water the garden' },
      generateUuidV7(),
    );

    const foreignMediaId = await registerMedia(foreign.ownerId, foreign.gardenId, 'available');
    const unavailableMediaId = await registerMedia(ownerId, gardenId, 'registered');

    await expect(
      handlers.attachTaskFile.execute(
        task.id,
        ownerId,
        { mediaId: foreignMediaId },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({ code: 'tasks_recommendations.task.invalid_media_reference' }),
      ],
    });

    await expect(
      handlers.attachTaskFile.execute(
        task.id,
        ownerId,
        { mediaId: unavailableMediaId },
        generateUuidV7(),
      ),
    ).rejects.toMatchObject({
      details: [
        expect.objectContaining({ code: 'tasks_recommendations.task.media_not_available' }),
      ],
    });

    const attachmentRows = await db
      .selectFrom('tasks_recommendations.task_attachment')
      .select(db.fn.countAll().as('count'))
      .where('task_id', '=', task.id)
      .executeTakeFirstOrThrow();
    expect(Number(attachmentRows.count)).toBe(0);
  });
});
