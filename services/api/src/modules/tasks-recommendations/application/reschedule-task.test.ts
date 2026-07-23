import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Task } from '../domain/task.js';
import { RescheduleTask } from './reschedule-task.js';
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

describe('RescheduleTask', () => {
  it('updates only dueDate/timeWindow, leaving title/urgency untouched', async () => {
    const fakes = fakesWithTask({ title: 'Original title', urgency: 'high' });
    const rescheduleTask = new RescheduleTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await rescheduleTask.execute(
      TASK_ID,
      PROFILE_ID,
      1,
      { dueDate: '2026-08-01' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result).toMatchObject({
      dueDate: '2026-08-01',
      title: 'Original title',
      urgency: 'high',
      revision: 2,
    });
    expect(fakes.revisionJournal.entries).toEqual([
      {
        taskId: TASK_ID,
        revision: 2,
        commandType: 'rescheduleTask',
        status: null,
        dueDate: '2026-08-01',
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('rejects a time window that ends before it starts', async () => {
    const fakes = fakesWithTask();
    const rescheduleTask = new RescheduleTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      rescheduleTask.execute(
        TASK_ID,
        PROFILE_ID,
        1,
        {
          timeWindow: {
            start: new Date('2026-08-01T10:00:00Z'),
            end: new Date('2026-08-01T09:00:00Z'),
          },
        },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('shares its underlying transition with EditTask: rejects once the task is dismissed', async () => {
    const fakes = fakesWithTask({ status: 'dismissed' });
    const rescheduleTask = new RescheduleTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      rescheduleTask.execute(
        TASK_ID,
        PROFILE_ID,
        1,
        { dueDate: '2026-08-01' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toThrow();
  });
});
