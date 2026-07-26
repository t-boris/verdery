/**
 * Read-only, authorized "shared activity history" for one task (P9A-TASK-01,
 * row B17: "Read who completed a task and when ... Allowed" for every role).
 * `viewGarden`, not `editGardenContent`: every member — owner, editor, and
 * viewer alike — may read who did what to a task, matching the matrix's own
 * rule and `GetTask`'s/`ListTasksForGarden`'s identical choice of capability
 * for a read.
 *
 * Mirrors `GetTask`'s exact shape: authorize against the path's own
 * `gardenId` first, then fetch by id and conceal both "no such task" and
 * "this task belongs to a different garden" as the identical
 * `taskNotFoundError`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { TaskActivityRepository } from './task-activity-repository.js';
import { toTaskActivityResource, type TaskActivityResource } from './task-activity-view.js';
import { taskNotFoundError } from './task-errors.js';
import type { TaskRepository } from './task-repository.js';

export class GetTaskActivity {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly activity: TaskActivityRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, taskId: Uuid, profileId: Uuid): Promise<TaskActivityResource[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const task = await this.tasks.findById(taskId);
    if (task === null || task.gardenId !== gardenId) {
      throw taskNotFoundError();
    }

    const entries = await this.activity.listForTask(taskId);
    return entries.map(toTaskActivityResource);
  }
}
