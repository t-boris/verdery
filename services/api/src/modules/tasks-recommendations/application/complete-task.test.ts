import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Task } from '../domain/task.js';
import { CompleteTask } from './complete-task.js';
import {
  authorizationGranting,
  buildTask,
  createTasksRecommendationsFakes,
  FakeTasksRecommendationsUnitOfWork,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const TASK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const NOW = new Date('2026-07-21T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'owner' as const,
};

function fakesWithTask(overrides: Partial<Task> = {}) {
  const fakes = createTasksRecommendationsFakes();
  fakes.tasks.tasks.set(TASK_ID, buildTask({ id: TASK_ID, gardenId: GARDEN_ID, ...overrides }));
  return fakes;
}

describe('CompleteTask', () => {
  it('completes a planned task, setting completedAt and journaling status', async () => {
    const fakes = fakesWithTask();
    const completeTask = new CompleteTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await completeTask.execute(
      TASK_ID,
      PROFILE_ID,
      1,
      'Done, watered thoroughly.',
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.status).toBe('completed');
    expect(result.completedAt).toBe(NOW.toISOString());
    expect(result.revision).toBe(2);
    expect(fakes.revisionJournal.entries).toEqual([
      {
        taskId: TASK_ID,
        revision: 2,
        commandType: 'completeTask',
        status: 'completed',
        dueDate: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('rejects completing an already-completed task', async () => {
    const fakes = fakesWithTask({ status: 'completed', completedAt: NOW });
    const completeTask = new CompleteTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      completeTask.execute(TASK_ID, PROFILE_ID, 1, null, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f'),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('rejects completing a dismissed/skipped/deleted task', async () => {
    for (const status of ['dismissed', 'skipped', 'deleted'] as const) {
      const fakes = fakesWithTask({ status });
      const completeTask = new CompleteTask(
        fakes.tasks,
        fakes.idempotency,
        new FakeTasksRecommendationsUnitOfWork(fakes),
        authorizationGranting(OWNER_MEMBERSHIP),
        fixedClock(NOW),
      );

      await expect(
        completeTask.execute(TASK_ID, PROFILE_ID, 1, undefined, `key-${status}`),
      ).rejects.toBeInstanceOf(DomainRuleViolatedError);
    }
  });
});
