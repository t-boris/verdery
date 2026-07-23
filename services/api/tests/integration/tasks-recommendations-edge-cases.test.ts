/**
 * Full-stack integration tests for tasks-recommendations edge cases against
 * real PostgreSQL/PostGIS: real repositories, the real transactional unit of
 * work, the real revision journal — not fakes. Split out of
 * `tests/integration/tasks-recommendations.test.ts` so neither file
 * approaches the repository's 600-line source-file limit, the same reason
 * `plants-inventory.test.ts`/`plants-inventory-search.test.ts` are split.
 *
 * Covers three P4-QA-01 concerns that file's own core-lifecycle coverage
 * does not: a `plant` target from a different garden (the polymorphic-target
 * counterpart to that file's `garden_area` cross-garden rejection), the
 * opaque `recurrenceRule` string round-tripping unchanged through `EditTask`
 * (it is stored only, never parsed — see `domain/task.ts`'s own comment on
 * the field), and `dueDate` surviving a hostile process time zone unshifted
 * (see `platform/database/pg-date-parser.ts`'s own doc comment on the bug
 * this guards against).
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { CreateGarden } from '../../src/modules/gardens-mapping/application/create-garden.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { GetObservation } from '../../src/modules/observations-history/application/get-observation.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { AddPlant } from '../../src/modules/plants-inventory/application/add-plant.js';
import { KyselyPlantsInventoryUnitOfWork } from '../../src/modules/plants-inventory/persistence/kysely-plants-inventory-unit-of-work.js';
import { CreateManualTask } from '../../src/modules/tasks-recommendations/application/create-manual-task.js';
import { EditTask } from '../../src/modules/tasks-recommendations/application/edit-task.js';
import { RescheduleTask } from '../../src/modules/tasks-recommendations/application/reschedule-task.js';
import { KyselyTaskRepository } from '../../src/modules/tasks-recommendations/persistence/kysely-task-repository.js';
import { KyselyTasksRecommendationsUnitOfWork } from '../../src/modules/tasks-recommendations/persistence/kysely-tasks-recommendations-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { ValidationError } from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'tasks-recommendations edge cases integration';
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
    };
  }

  it('rejects a plant target that belongs to a different garden', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const otherGarden = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const foreignPlantId = await addPlant(
      otherGarden.gardenId,
      otherGarden.ownerId,
      fixedClock(now),
    );

    await expect(
      handlers.createManualTask.execute(
        gardenId,
        ownerId,
        { target: { kind: 'plant', plantId: foreignPlantId }, title: 'Inspect for pests' },
        generateUuidV7(),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('round-trips an opaque recurrenceRule through EditTask unchanged, since this pass never parses it', async () => {
    const now = new Date('2026-07-21T09:00:00Z');
    const { ownerId, gardenId } = await createGardenWithOwner(now);
    const handlers = buildHandlers(fixedClock(now));
    const task = await handlers.createManualTask.execute(
      gardenId,
      ownerId,
      { target: { kind: 'garden' }, title: 'Water the garden' },
      generateUuidV7(),
    );
    expect(task.recurrenceRule).toBeNull();

    const edited = await handlers.editTask.execute(
      task.id,
      ownerId,
      task.revision,
      { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' },
      generateUuidV7(),
    );
    expect(edited.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');

    const reloaded = await handlers.taskRepository.findById(task.id);
    expect(reloaded?.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });

  it('round-trips dueDate unshifted regardless of the process time zone (pg-date-parser)', async () => {
    const originalTz = process.env['TZ'];
    // UTC+14: the most positive offset in use, the case pg-date-parser's own doc comment calls out.
    process.env['TZ'] = 'Pacific/Kiritimati';
    try {
      const now = new Date('2026-07-21T09:00:00Z');
      const { ownerId, gardenId } = await createGardenWithOwner(now);
      const handlers = buildHandlers(fixedClock(now));
      const task = await handlers.createManualTask.execute(
        gardenId,
        ownerId,
        { target: { kind: 'garden' }, title: 'Water the garden', dueDate: '2026-01-01' },
        generateUuidV7(),
      );
      expect(task.dueDate).toBe('2026-01-01');

      const reloaded = await handlers.taskRepository.findById(task.id);
      expect(reloaded?.dueDate).toBe('2026-01-01');

      const rescheduled = await handlers.rescheduleTask.execute(
        task.id,
        ownerId,
        task.revision,
        { dueDate: '2026-12-31' },
        generateUuidV7(),
      );
      expect(rescheduled.dueDate).toBe('2026-12-31');
    } finally {
      process.env['TZ'] = originalTz;
    }
  });
});
