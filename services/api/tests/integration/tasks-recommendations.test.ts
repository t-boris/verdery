/**
 * Full-stack integration tests for the tasks-recommendations module against
 * real PostgreSQL/PostGIS: real repositories, the real transactional unit of
 * work, the real revision journal — not fakes. Mirrors the rigor of
 * `tests/integration/plants-inventory.test.ts` and
 * `tests/integration/observations-history.test.ts`.
 *
 * Covers `CreateManualTask` against all three target kinds (including the
 * consistency-check rejection), the full status lifecycle
 * (`CompleteTask`/`DismissTask`/`SkipTask`/`DeleteTask`, each from `'planned'`
 * and each rejecting a second application or one from another terminal
 * state), `EditTask`/`RescheduleTask` succeeding while planned and rejecting
 * once terminal, a stale-`expectedRevision` rejection, the `task_revision`
 * journal, and `AttachTaskFile` with a real media reference.
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
import { RegisterMediaRecord } from '../../src/modules/media/application/register-media-record.js';
import { KyselyMediaUnitOfWork } from '../../src/modules/media/persistence/kysely-media-unit-of-work.js';
import { GetObservation } from '../../src/modules/observations-history/application/get-observation.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { AttachTaskFile } from '../../src/modules/tasks-recommendations/application/attach-task-file.js';
import { CompleteTask } from '../../src/modules/tasks-recommendations/application/complete-task.js';
import { CreateManualTask } from '../../src/modules/tasks-recommendations/application/create-manual-task.js';
import { DeleteTask } from '../../src/modules/tasks-recommendations/application/delete-task.js';
import { DismissTask } from '../../src/modules/tasks-recommendations/application/dismiss-task.js';
import { EditTask } from '../../src/modules/tasks-recommendations/application/edit-task.js';
import { ListTasksForGarden } from '../../src/modules/tasks-recommendations/application/list-tasks-for-garden.js';
import { RescheduleTask } from '../../src/modules/tasks-recommendations/application/reschedule-task.js';
import { SkipTask } from '../../src/modules/tasks-recommendations/application/skip-task.js';
import { KyselyTaskRepository } from '../../src/modules/tasks-recommendations/persistence/kysely-task-repository.js';
import { KyselyTasksRecommendationsUnitOfWork } from '../../src/modules/tasks-recommendations/persistence/kysely-tasks-recommendations-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import {
  DomainRuleViolatedError,
  StaleRevisionError,
  ValidationError,
} from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'tasks-recommendations integration';
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

  async function addPlant(gardenId: string, ownerId: string, clock: Clock): Promise<string> {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const addPlantCommand = new AddPlant(
      new KyselyIdempotencyStore(db, clock),
      new KyselyPlantsInventoryUnitOfWork(db, clock),
      authorization,
      clock,
    );
    const plant = await addPlantCommand.execute(
      gardenId,
      ownerId,
      { displayName: 'Tomato', groupingKind: 'individual' },
      generateUuidV7(),
    );
    return plant.id;
  }

  async function registerMedia(ownerId: string, clock: Clock): Promise<string> {
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const media = await registerMediaRecord.execute(
      ownerId,
      'gs://verdery-media/task-photo.jpg',
      'image/jpeg',
      generateUuidV7(),
    );
    return media.id;
  }

  function buildHandlers(clock: Clock) {
    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const idempotency = new KyselyIdempotencyStore(db, clock);
    const unitOfWork = new KyselyTasksRecommendationsUnitOfWork(db, clock);
    const taskRepository = new KyselyTaskRepository(db);
    const getObservation = new GetObservation(new KyselyObservationRepository(db));

    return {
      taskRepository,
      createManualTask: new CreateManualTask(
        idempotency,
        unitOfWork,
        authorization,
        getObservation,
        clock,
      ),
      editTask: new EditTask(taskRepository, idempotency, unitOfWork, authorization, clock),
      rescheduleTask: new RescheduleTask(
        taskRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
      completeTask: new CompleteTask(taskRepository, idempotency, unitOfWork, authorization, clock),
      dismissTask: new DismissTask(taskRepository, idempotency, unitOfWork, authorization, clock),
      skipTask: new SkipTask(taskRepository, idempotency, unitOfWork, authorization, clock),
      deleteTask: new DeleteTask(taskRepository, idempotency, unitOfWork, authorization, clock),
      listTasksForGarden: new ListTasksForGarden(taskRepository, authorization),
      attachTaskFile: new AttachTaskFile(
        taskRepository,
        idempotency,
        unitOfWork,
        authorization,
        clock,
      ),
    };
  }

  it('creates a task against each of the three target kinds, journals it, and rejects a mismatched target/kind', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const lotId = await createLot(gardenId, ownerId, fixedClock(now));
    const plantId = await addPlant(gardenId, ownerId, fixedClock(now));

    const gardenTask = await handlers.createManualTask.execute(
      gardenId,
      ownerId,
      { target: { kind: 'garden' }, title: 'Water the whole garden' },
      generateUuidV7(),
    );
    expect(gardenTask).toMatchObject({
      gardenId,
      targetKind: 'garden',
      status: 'planned',
      source: 'manual',
      revision: 1,
    });

    const areaTask = await handlers.createManualTask.execute(
      gardenId,
      ownerId,
      {
        target: { kind: 'garden_area', gardenAreaMapObjectId: lotId },
        title: 'Weed the lot',
        dueDate: '2026-08-01',
      },
      generateUuidV7(),
    );
    expect(areaTask.targetGardenAreaMapObjectId).toBe(lotId);

    const plantTask = await handlers.createManualTask.execute(
      gardenId,
      ownerId,
      { target: { kind: 'plant', plantId }, title: 'Inspect for pests' },
      generateUuidV7(),
    );
    expect(plantTask.targetPlantId).toBe(plantId);

    const revisionRow = await db
      .selectFrom('tasks_recommendations.task_revision')
      .selectAll()
      .where('task_id', '=', areaTask.id)
      .executeTakeFirst();
    expect(revisionRow).toMatchObject({
      revision: 1,
      command_type: 'createManualTask',
      status: 'planned',
      due_date: '2026-08-01',
    });

    await expect(
      handlers.createManualTask.execute(
        gardenId,
        ownerId,
        { target: { kind: 'garden', plantId }, title: 'Bad target' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    const listed = await handlers.listTasksForGarden.execute(gardenId, ownerId);
    expect(listed).toHaveLength(3);
  });

  it('rejects a garden_area target that does not name a real object in this garden', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const otherGarden = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const foreignLotId = await createLot(
      otherGarden.gardenId,
      otherGarden.ownerId,
      fixedClock(now),
    );

    await expect(
      handlers.createManualTask.execute(
        gardenId,
        ownerId,
        { target: { kind: 'garden_area', gardenAreaMapObjectId: foreignLotId }, title: 'Weed' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('completes, dismisses, skips, and deletes a planned task, each rejecting a second application', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));

    async function newTask(title: string) {
      return handlers.createManualTask.execute(
        gardenId,
        ownerId,
        { target: { kind: 'garden' }, title },
        generateUuidV7(),
      );
    }

    const toComplete = await newTask('Complete me');
    const completed = await handlers.completeTask.execute(
      toComplete.id,
      ownerId,
      toComplete.revision,
      'All done.',
      generateUuidV7(),
    );
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
    await expect(
      handlers.completeTask.execute(
        toComplete.id,
        ownerId,
        completed.revision,
        null,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    const toDismiss = await newTask('Dismiss me');
    const dismissed = await handlers.dismissTask.execute(
      toDismiss.id,
      ownerId,
      toDismiss.revision,
      'No longer needed.',
      generateUuidV7(),
    );
    expect(dismissed.status).toBe('dismissed');
    await expect(
      handlers.dismissTask.execute(
        toDismiss.id,
        ownerId,
        dismissed.revision,
        null,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    const toSkip = await newTask('Skip me');
    const skipped = await handlers.skipTask.execute(
      toSkip.id,
      ownerId,
      toSkip.revision,
      generateUuidV7(),
    );
    expect(skipped.status).toBe('skipped');
    await expect(
      handlers.skipTask.execute(toSkip.id, ownerId, skipped.revision, generateUuidV7()),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    const toDelete = await newTask('Delete me');
    const deleted = await handlers.deleteTask.execute(
      toDelete.id,
      ownerId,
      toDelete.revision,
      generateUuidV7(),
    );
    expect(deleted.status).toBe('deleted');
    await expect(
      handlers.deleteTask.execute(toDelete.id, ownerId, deleted.revision, generateUuidV7()),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    // No hard delete: the row still exists, just in a terminal status.
    const stillExists = await db
      .selectFrom('tasks_recommendations.task')
      .selectAll()
      .where('id', '=', toDelete.id)
      .executeTakeFirst();
    expect(stillExists).toBeDefined();

    // Cross-terminal rejection: a dismissed task cannot then be completed.
    await expect(
      handlers.completeTask.execute(
        toDismiss.id,
        ownerId,
        dismissed.revision,
        null,
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);

    const rows = await db
      .selectFrom('tasks_recommendations.task_revision')
      .select(['command_type', 'status'])
      .where('task_id', '=', toComplete.id)
      .orderBy('revision', 'asc')
      .execute();
    expect(rows).toEqual([
      { command_type: 'createManualTask', status: 'planned' },
      { command_type: 'completeTask', status: 'completed' },
    ]);
  });

  it('edits and reschedules a planned task, then rejects both once the task is completed, with a revision guard throughout', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const task = await handlers.createManualTask.execute(
      gardenId,
      ownerId,
      { target: { kind: 'garden' }, title: 'Water the garden' },
      generateUuidV7(),
    );

    await expect(
      handlers.editTask.execute(task.id, ownerId, 999, { title: 'Stale' }, generateUuidV7()),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    const edited = await handlers.editTask.execute(
      task.id,
      ownerId,
      task.revision,
      { title: 'Water the garden deeply', urgency: 'high' },
      generateUuidV7(),
    );
    expect(edited).toMatchObject({
      title: 'Water the garden deeply',
      urgency: 'high',
      revision: 2,
    });

    const rescheduled = await handlers.rescheduleTask.execute(
      task.id,
      ownerId,
      edited.revision,
      { dueDate: '2026-08-15' },
      generateUuidV7(),
    );
    expect(rescheduled).toMatchObject({
      dueDate: '2026-08-15',
      title: 'Water the garden deeply',
      revision: 3,
    });

    const completed = await handlers.completeTask.execute(
      task.id,
      ownerId,
      rescheduled.revision,
      null,
      generateUuidV7(),
    );

    await expect(
      handlers.editTask.execute(
        task.id,
        ownerId,
        completed.revision,
        { title: 'Too late' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
    await expect(
      handlers.rescheduleTask.execute(
        task.id,
        ownerId,
        completed.revision,
        { dueDate: '2026-09-01' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('attaches a real media reference via AttachTaskFile, leaving the task revision untouched', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const task = await handlers.createManualTask.execute(
      gardenId,
      ownerId,
      { target: { kind: 'garden' }, title: 'Water the garden' },
      generateUuidV7(),
    );
    const mediaId = await registerMedia(ownerId, fixedClock(now));

    const attachment = await handlers.attachTaskFile.execute(
      task.id,
      ownerId,
      { mediaId },
      generateUuidV7(),
    );
    expect(attachment).toMatchObject({ taskId: task.id, mediaId });

    const row = await db
      .selectFrom('tasks_recommendations.task_attachment')
      .selectAll()
      .where('task_id', '=', task.id)
      .executeTakeFirst();
    expect(row).toBeDefined();

    const unchanged = await handlers.taskRepository.findById(task.id);
    expect(unchanged?.revision).toBe(1);

    await expect(
      handlers.attachTaskFile.execute(
        task.id,
        ownerId,
        { mediaId: generateUuidV7() },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
