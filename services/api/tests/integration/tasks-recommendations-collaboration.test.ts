/**
 * Full-stack integration tests for task assignment, reassignment,
 * completion attribution, and shared activity history (P9A-TASK-01) —
 * real PostgreSQL, real repositories, the real transactional unit of work,
 * never fakes. Sibling to `tasks-recommendations.test.ts` (the base task
 * lifecycle) and `collaboration-membership.test.ts` (membership
 * administration), split out for this work package's own concerns.
 *
 * Completion evidence this suite exists to provide: "Concurrent assignment
 * and actor-attribution tests" — see the two `it` blocks with those words
 * in their own titles below.
 *
 * Source: implementation-plan.md work package P9A-TASK-01;
 * docs/development/garden-capability-matrix.md, rows B14-B17.
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { TASK_ASSIGNED_EVENT_TYPE } from '@verdery/api-contracts';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { GardenAuthorization } from '../../src/modules/gardens-mapping/application/garden-authorization.js';
import { RemoveMember } from '../../src/modules/gardens-mapping/application/remove-member.js';
import { KyselyGardensMappingUnitOfWork } from '../../src/modules/gardens-mapping/persistence/kysely-gardens-mapping-unit-of-work.js';
import { KyselyMembershipRepository } from '../../src/modules/gardens-mapping/persistence/kysely-membership-repository.js';
import { GetObservation } from '../../src/modules/observations-history/application/get-observation.js';
import { KyselyObservationRepository } from '../../src/modules/observations-history/persistence/kysely-observation-repository.js';
import { AssignTask } from '../../src/modules/tasks-recommendations/application/assign-task.js';
import { CompleteTask } from '../../src/modules/tasks-recommendations/application/complete-task.js';
import { CreateManualTask } from '../../src/modules/tasks-recommendations/application/create-manual-task.js';
import { GetTaskActivity } from '../../src/modules/tasks-recommendations/application/get-task-activity.js';
import { KyselyTaskActivityRepository } from '../../src/modules/tasks-recommendations/persistence/kysely-task-activity-repository.js';
import { KyselyTaskRepository } from '../../src/modules/tasks-recommendations/persistence/kysely-task-repository.js';
import { KyselyTasksRecommendationsUnitOfWork } from '../../src/modules/tasks-recommendations/persistence/kysely-tasks-recommendations-unit-of-work.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import {
  ForbiddenError,
  StaleRevisionError,
  ValidationError,
} from '../../src/platform/errors/application-error.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  fixedClock,
  insertGarden,
  insertMembership,
  insertProfile,
} from '../support/collaboration-integration-harness.js';

const SUITE_NAME = 'tasks-recommendations collaboration integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

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

    // Headroom for the concurrent-assignment test's two in-flight
    // transactions plus ordinary fixture traffic.
    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  const taskRepository = () => new KyselyTaskRepository(db);
  const authorization = () => new GardenAuthorization(new KyselyMembershipRepository(db));

  function createManualTaskCommand(now: Date) {
    return new CreateManualTask(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyTasksRecommendationsUnitOfWork(db, fixedClock(now)),
      authorization(),
      new GetObservation(new KyselyObservationRepository(db)),
      fixedClock(now),
    );
  }

  function assignTaskCommand(now: Date) {
    return new AssignTask(
      taskRepository(),
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyTasksRecommendationsUnitOfWork(db, fixedClock(now)),
      authorization(),
      fixedClock(now),
    );
  }

  function completeTaskCommand(now: Date) {
    return new CompleteTask(
      taskRepository(),
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyTasksRecommendationsUnitOfWork(db, fixedClock(now)),
      authorization(),
      fixedClock(now),
    );
  }

  function getTaskActivityQuery() {
    return new GetTaskActivity(
      taskRepository(),
      new KyselyTaskActivityRepository(db),
      authorization(),
    );
  }

  function removeMemberCommand(now: Date) {
    return new RemoveMember(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyGardensMappingUnitOfWork(db, fixedClock(now)),
      authorization(),
      fixedClock(now),
    );
  }

  async function createTask(gardenId: string, ownerId: string, now: Date): Promise<string> {
    const task = await createManualTaskCommand(now).execute(
      gardenId,
      ownerId,
      { target: { kind: 'garden' }, title: 'Weed the beds' },
      generateUuidV7(),
    );
    return task.id;
  }

  it('assigns, reassigns, and unassigns a task, journaling every change as its shared activity history and emitting task.assigned only for real assignments', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorA = await insertProfile(db);
    await insertMembership(db, gardenId, editorA, 'editor', JANUARY);
    const editorB = await insertProfile(db);
    await insertMembership(db, gardenId, editorB, 'editor', JANUARY);

    const taskId = await createTask(gardenId, ownerId, JANUARY);

    const assigned = await assignTaskCommand(JANUARY).execute(
      taskId,
      ownerId,
      1,
      editorA,
      generateUuidV7(),
    );
    expect(assigned).toMatchObject({
      assignedProfileId: editorA,
      assignedAt: JANUARY.toISOString(),
      revision: 2,
    });

    const reassigned = await assignTaskCommand(JANUARY).execute(
      taskId,
      ownerId,
      2,
      editorB,
      generateUuidV7(),
    );
    expect(reassigned).toMatchObject({ assignedProfileId: editorB, revision: 3 });

    const unassigned = await assignTaskCommand(JANUARY).execute(
      taskId,
      ownerId,
      3,
      null,
      generateUuidV7(),
    );
    expect(unassigned).toMatchObject({
      assignedProfileId: null,
      assignedAt: null,
      revision: 4,
    });

    // The shared activity history: task_revision, read back through
    // GetTaskActivity, IS the assignment history — one row per accepted
    // command, oldest first.
    const activity = await getTaskActivityQuery().execute(gardenId, taskId, ownerId);
    expect(activity.map((entry) => [entry.commandType, entry.assignedProfileId])).toEqual([
      ['createManualTask', null],
      ['assignTask', editorA],
      ['assignTask', editorB],
      ['assignTask', null],
    ]);

    // task.assigned is appended for the two real assignments and NOT for
    // the unassignment — nobody to notify about that one.
    const outboxEvents = await db
      .selectFrom('platform.outbox_event')
      .selectAll()
      .where('aggregate_id', '=', taskId)
      .where('event_type', '=', TASK_ASSIGNED_EVENT_TYPE)
      .orderBy('id', 'asc')
      .execute();
    expect(outboxEvents).toHaveLength(2);
    expect(outboxEvents.map((row) => row.payload)).toEqual([
      expect.objectContaining({ assigneeProfileId: editorA, previousAssigneeProfileId: null }),
      expect.objectContaining({ assigneeProfileId: editorB, previousAssigneeProfileId: editorA }),
    ]);
  });

  it('rejects assigning to a viewer or a non-member, and rejects a viewer acting as the assigner (row B14)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);
    const viewerId = await insertProfile(db);
    await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);
    const strangerId = await insertProfile(db);

    const taskId = await createTask(gardenId, ownerId, JANUARY);

    await expect(
      assignTaskCommand(JANUARY).execute(taskId, ownerId, 1, viewerId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      assignTaskCommand(JANUARY).execute(taskId, ownerId, 1, strangerId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      assignTaskCommand(JANUARY).execute(taskId, viewerId, 1, editorId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('attributes completion to the ACTUAL caller, and the attribution survives that caller losing garden access', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const assigneeId = await insertProfile(db);
    await insertMembership(db, gardenId, assigneeId, 'editor', JANUARY);

    const taskId = await createTask(gardenId, ownerId, JANUARY);
    await assignTaskCommand(JANUARY).execute(taskId, ownerId, 1, assigneeId, generateUuidV7());

    const completed = await completeTaskCommand(MARCH).execute(
      taskId,
      assigneeId,
      2,
      null,
      generateUuidV7(),
    );
    expect(completed.completedByProfileId).toBe(assigneeId);
    expect(completed.assignedProfileId).toBe(assigneeId);

    // THE POINT: remove the completer from the garden entirely, then prove
    // the attribution is still readable — it references the profile, never
    // the membership.
    await removeMemberCommand(MARCH).execute(gardenId, assigneeId, ownerId, generateUuidV7());

    const membershipAfterRemoval = await new KyselyMembershipRepository(
      db,
    ).findActiveByGardenAndProfile(gardenId, assigneeId);
    expect(membershipAfterRemoval).toBeNull();

    const reread = await taskRepository().findById(taskId);
    expect(reread?.completedByProfileId).toBe(assigneeId);
    expect(reread?.status).toBe('completed');
  });

  it('resolves CONCURRENT ASSIGNMENT of the same task to two different people through the revision guard: one wins, the loser gets a clean conflict, never a corrupted task', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const otherActorId = await insertProfile(db);
    await insertMembership(db, gardenId, otherActorId, 'editor', JANUARY);
    const candidateA = await insertProfile(db);
    await insertMembership(db, gardenId, candidateA, 'editor', JANUARY);
    const candidateB = await insertProfile(db);
    await insertMembership(db, gardenId, candidateB, 'editor', JANUARY);

    const taskId = await createTask(gardenId, ownerId, JANUARY);

    // Two different actors (owner and an editor), racing to assign the SAME
    // task, at the SAME starting revision, to two DIFFERENT people — genuine
    // concurrent Postgres transactions via two independent command
    // instances launched together, the same `Promise.allSettled` proof
    // `collaboration-membership.test.ts` uses for the last-owner race.
    const results = await Promise.allSettled([
      assignTaskCommand(JANUARY).execute(taskId, ownerId, 1, candidateA, generateUuidV7()),
      assignTaskCommand(JANUARY).execute(taskId, otherActorId, 1, candidateB, generateUuidV7()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleRevisionError);

    // THE POINT: exactly one assignment survives, at revision 2, naming
    // EITHER candidate — never both, never neither, never a torn write.
    const final = await taskRepository().findById(taskId);
    expect(final?.revision).toBe(2);
    expect([candidateA, candidateB]).toContain(final?.assignedProfileId);

    const winningPayload = (
      fulfilled[0] as PromiseFulfilledResult<{ assignedProfileId: string | null }>
    ).value.assignedProfileId;
    expect(final?.assignedProfileId).toBe(winningPayload);
  });
});
