import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Task } from '../domain/task.js';
import { DeleteTask } from './delete-task.js';
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

describe('DeleteTask', () => {
  it('models delete as a status transition, not a hard delete', async () => {
    const fakes = fakesWithTask();
    const deleteTask = new DeleteTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await deleteTask.execute(
      TASK_ID,
      PROFILE_ID,
      1,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result.status).toBe('deleted');
    expect(fakes.tasks.tasks.has(TASK_ID)).toBe(true);
  });

  it('is terminal: rejects deleting an already-deleted task', async () => {
    const fakes = fakesWithTask({ status: 'deleted' });
    const deleteTask = new DeleteTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      deleteTask.execute(TASK_ID, PROFILE_ID, 1, '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f'),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });
});
