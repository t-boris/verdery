import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  StaleRevisionError,
} from '../../../platform/errors/application-error.js';
import type { Task } from '../domain/task.js';
import { EditTask } from './edit-task.js';
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

describe('EditTask', () => {
  it('applies title/notes/urgency/recurrenceRule changes, bumping the revision', async () => {
    const fakes = fakesWithTask();
    const editTask = new EditTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    const result = await editTask.execute(
      TASK_ID,
      PROFILE_ID,
      1,
      { title: 'Water deeply', urgency: 'high', recurrenceRule: 'FREQ=WEEKLY' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e',
    );

    expect(result).toMatchObject({
      title: 'Water deeply',
      urgency: 'high',
      recurrenceRule: 'FREQ=WEEKLY',
      revision: 2,
    });
    expect(fakes.revisionJournal.entries).toEqual([
      {
        taskId: TASK_ID,
        revision: 2,
        commandType: 'editTask',
        status: null,
        dueDate: null,
        actorProfileId: PROFILE_ID,
      },
    ]);
  });

  it('journals dueDate only when it was part of the changes', async () => {
    const fakes = fakesWithTask();
    const editTask = new EditTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await editTask.execute(
      TASK_ID,
      PROFILE_ID,
      1,
      { dueDate: '2026-08-01' },
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f',
    );

    expect(fakes.revisionJournal.entries[0]?.dueDate).toBe('2026-08-01');
  });

  it('rejects editing a completed task', async () => {
    const fakes = fakesWithTask({ status: 'completed', completedAt: NOW });
    const editTask = new EditTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      editTask.execute(
        TASK_ID,
        PROFILE_ID,
        1,
        { title: 'Too late' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10',
      ),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('rejects a stale expectedRevision', async () => {
    const fakes = fakesWithTask();
    const editTask = new EditTask(
      fakes.tasks,
      fakes.idempotency,
      new FakeTasksRecommendationsUnitOfWork(fakes),
      authorizationGranting(OWNER_MEMBERSHIP),
      fixedClock(NOW),
    );

    await expect(
      editTask.execute(
        TASK_ID,
        PROFILE_ID,
        999,
        { title: 'x' },
        '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11',
      ),
    ).rejects.toBeInstanceOf(StaleRevisionError);
  });
});
