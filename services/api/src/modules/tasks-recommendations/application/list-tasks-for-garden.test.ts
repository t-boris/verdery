import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import { ListTasksForGarden } from './list-tasks-for-garden.js';
import {
  authorizationDenying,
  authorizationGranting,
  buildTask,
  createTasksRecommendationsFakes,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const TASK_ID_1 = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const TASK_ID_2 = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0e';

const VIEWER_MEMBERSHIP = {
  id: 'membership-1',
  gardenId: GARDEN_ID,
  profileId: PROFILE_ID,
  role: 'viewer' as const,
};

describe('ListTasksForGarden', () => {
  it('lists every task in the garden for a caller with viewGarden', async () => {
    const fakes = createTasksRecommendationsFakes();
    fakes.tasks.tasks.set(TASK_ID_1, buildTask({ id: TASK_ID_1, gardenId: GARDEN_ID, title: 'A' }));
    fakes.tasks.tasks.set(TASK_ID_2, buildTask({ id: TASK_ID_2, gardenId: GARDEN_ID, title: 'B' }));
    const listTasksForGarden = new ListTasksForGarden(
      fakes.tasks,
      authorizationGranting(VIEWER_MEMBERSHIP),
    );

    const result = await listTasksForGarden.execute(GARDEN_ID, PROFILE_ID);
    expect(result).toHaveLength(2);
  });

  it('rejects a caller with no membership on the garden, concealing it as not found', async () => {
    const fakes = createTasksRecommendationsFakes();
    const listTasksForGarden = new ListTasksForGarden(fakes.tasks, authorizationDenying());

    await expect(listTasksForGarden.execute(GARDEN_ID, PROFILE_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
