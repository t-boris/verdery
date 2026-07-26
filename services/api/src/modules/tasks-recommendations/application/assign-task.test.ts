import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  ForbiddenError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import { TASK_ASSIGNED_EVENT_TYPE } from '@verdery/api-contracts';
import type { Task } from '../domain/task.js';
import { AssignTask } from './assign-task.js';
import {
  authorizationGrantingMany,
  buildTask,
  createTasksRecommendationsFakes,
  FakeTasksRecommendationsUnitOfWork,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const TASK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const OWNER_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const EDITOR_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const OTHER_EDITOR_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const VIEWER_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a10';
const STRANGER_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a11';
const NOW = new Date('2026-07-21T10:00:00Z');

const OWNER_MEMBERSHIP = {
  id: 'm-owner',
  gardenId: GARDEN_ID,
  profileId: OWNER_ID,
  role: 'owner' as const,
};
const EDITOR_MEMBERSHIP = {
  id: 'm-editor',
  gardenId: GARDEN_ID,
  profileId: EDITOR_ID,
  role: 'editor' as const,
};
const OTHER_EDITOR_MEMBERSHIP = {
  id: 'm-other-editor',
  gardenId: GARDEN_ID,
  profileId: OTHER_EDITOR_ID,
  role: 'editor' as const,
};
const VIEWER_MEMBERSHIP = {
  id: 'm-viewer',
  gardenId: GARDEN_ID,
  profileId: VIEWER_ID,
  role: 'viewer' as const,
};

function fakesWithTask(overrides: Partial<Task> = {}) {
  const fakes = createTasksRecommendationsFakes();
  fakes.tasks.tasks.set(TASK_ID, buildTask({ id: TASK_ID, gardenId: GARDEN_ID, ...overrides }));
  return fakes;
}

function buildAssignTask(fakes: ReturnType<typeof fakesWithTask>) {
  return new AssignTask(
    fakes.tasks,
    fakes.idempotency,
    new FakeTasksRecommendationsUnitOfWork(fakes),
    authorizationGrantingMany([
      OWNER_MEMBERSHIP,
      EDITOR_MEMBERSHIP,
      OTHER_EDITOR_MEMBERSHIP,
      VIEWER_MEMBERSHIP,
    ]),
    fixedClock(NOW),
  );
}

describe('AssignTask', () => {
  it('assigns a task to an eligible active member, journaling and syncing it', async () => {
    const fakes = fakesWithTask();
    const assignTask = buildAssignTask(fakes);

    const result = await assignTask.execute(
      TASK_ID,
      OWNER_ID,
      1,
      EDITOR_ID,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a20',
    );

    expect(result.assignedProfileId).toBe(EDITOR_ID);
    expect(result.assignedAt).toBe(NOW.toISOString());
    expect(result.revision).toBe(2);
    expect(fakes.revisionJournal.entries).toEqual([
      {
        taskId: TASK_ID,
        revision: 2,
        commandType: 'assignTask',
        status: null,
        dueDate: null,
        assignedProfileId: EDITOR_ID,
        actorProfileId: OWNER_ID,
      },
    ]);
    expect(fakes.syncChanges.entries).toEqual([
      {
        gardenId: GARDEN_ID,
        recordId: TASK_ID,
        recordType: 'task',
        operation: 'upsert',
        recordRevision: 2,
      },
    ]);
  });

  it('appends a task.assigned outbox event carrying the previous assignee', async () => {
    const fakes = fakesWithTask({ assignedProfileId: EDITOR_ID, assignedAt: NOW });
    const assignTask = buildAssignTask(fakes);

    await assignTask.execute(
      TASK_ID,
      OWNER_ID,
      1,
      OTHER_EDITOR_ID,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a21',
    );

    expect(fakes.outbox.events).toEqual([
      {
        eventType: TASK_ASSIGNED_EVENT_TYPE,
        aggregateType: 'task',
        aggregateId: TASK_ID,
        payload: {
          taskId: TASK_ID,
          gardenId: GARDEN_ID,
          assigneeProfileId: OTHER_EDITOR_ID,
          previousAssigneeProfileId: EDITOR_ID,
          assignedByProfileId: OWNER_ID,
        },
      },
    ]);
  });

  it('unassigns by passing null, clearing both columns and appending no outbox event', async () => {
    const fakes = fakesWithTask({ assignedProfileId: EDITOR_ID, assignedAt: NOW });
    const assignTask = buildAssignTask(fakes);

    const result = await assignTask.execute(
      TASK_ID,
      OWNER_ID,
      1,
      null,
      '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a22',
    );

    expect(result.assignedProfileId).toBeNull();
    expect(result.assignedAt).toBeNull();
    expect(fakes.revisionJournal.entries).toEqual([
      expect.objectContaining({ commandType: 'assignTask', assignedProfileId: null }),
    ]);
    expect(fakes.outbox.events).toHaveLength(0);
  });

  it('rejects assigning to a viewer', async () => {
    const fakes = fakesWithTask();
    const assignTask = buildAssignTask(fakes);

    await expect(
      assignTask.execute(TASK_ID, OWNER_ID, 1, VIEWER_ID, 'key-viewer'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects assigning to a profile with no membership on this garden', async () => {
    const fakes = fakesWithTask();
    const assignTask = buildAssignTask(fakes);

    await expect(
      assignTask.execute(TASK_ID, OWNER_ID, 1, STRANGER_ID, 'key-stranger'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a viewer acting as the assigner', async () => {
    const fakes = fakesWithTask();
    const assignTask = buildAssignTask(fakes);

    await expect(
      assignTask.execute(TASK_ID, VIEWER_ID, 1, EDITOR_ID, 'key-viewer-actor'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows self-assignment', async () => {
    const fakes = fakesWithTask();
    const assignTask = buildAssignTask(fakes);

    const result = await assignTask.execute(TASK_ID, EDITOR_ID, 1, EDITOR_ID, 'key-self');
    expect(result.assignedProfileId).toBe(EDITOR_ID);
  });

  it('rejects assigning a task that is no longer editable', async () => {
    const fakes = fakesWithTask({ status: 'completed', completedAt: NOW });
    const assignTask = buildAssignTask(fakes);

    await expect(
      assignTask.execute(TASK_ID, OWNER_ID, 1, EDITOR_ID, 'key-completed'),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });
});
