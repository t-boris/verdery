import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { GetTaskActivity } from './get-task-activity.js';
import {
  activityFromJournal,
  authorizationGranting,
  buildTask,
  FakeTaskActivityRepository,
  FakeTaskRepository,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const OTHER_GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const TASK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const OWNER_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';
const ASSIGNEE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0f';
const NOW = new Date('2026-07-21T10:00:00Z');
const LATER = new Date('2026-07-21T11:00:00Z');

const VIEWER_MEMBERSHIP = {
  id: 'm-1',
  gardenId: GARDEN_ID,
  profileId: OWNER_ID,
  role: 'viewer' as const,
};

describe('GetTaskActivity', () => {
  it('returns every task_revision row for the task, oldest first — the shared activity history', async () => {
    const tasks = new FakeTaskRepository();
    await tasks.insert(buildTask({ id: TASK_ID, gardenId: GARDEN_ID }));

    const activity = new FakeTaskActivityRepository(
      new Map([
        [
          TASK_ID,
          [
            activityFromJournal(
              {
                taskId: TASK_ID,
                revision: 1,
                commandType: 'createManualTask',
                status: 'planned',
                dueDate: null,
                assignedProfileId: null,
                actorProfileId: OWNER_ID,
              },
              NOW,
            ),
            activityFromJournal(
              {
                taskId: TASK_ID,
                revision: 2,
                commandType: 'assignTask',
                status: null,
                dueDate: null,
                assignedProfileId: ASSIGNEE_ID,
                actorProfileId: OWNER_ID,
              },
              LATER,
            ),
          ],
        ],
      ]),
    );

    const getTaskActivity = new GetTaskActivity(
      tasks,
      activity,
      authorizationGranting(VIEWER_MEMBERSHIP),
    );

    const entries = await getTaskActivity.execute(GARDEN_ID, TASK_ID, OWNER_ID);

    expect(entries).toEqual([
      expect.objectContaining({ revision: 1, commandType: 'createManualTask' }),
      expect.objectContaining({
        revision: 2,
        commandType: 'assignTask',
        assignedProfileId: ASSIGNEE_ID,
        recordedAt: LATER.toISOString(),
      }),
    ]);
  });

  it('conceals a task belonging to a different garden as not found', async () => {
    const tasks = new FakeTaskRepository();
    await tasks.insert(buildTask({ id: TASK_ID, gardenId: OTHER_GARDEN_ID }));
    const getTaskActivity = new GetTaskActivity(
      tasks,
      new FakeTaskActivityRepository(),
      authorizationGranting(VIEWER_MEMBERSHIP),
    );

    await expect(getTaskActivity.execute(GARDEN_ID, TASK_ID, OWNER_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
