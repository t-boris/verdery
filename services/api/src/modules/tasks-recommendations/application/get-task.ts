/**
 * Read-only, authorized lookup for a single task.
 *
 * Added for the synchronization module's `POST /v1/sync/push`: a
 * `SyncConflictOperationResult` for a `task` operation needs the current
 * authorized server representation (section "14.2 Same Mutable Object"), and
 * nothing before this exposed a single-task, capability-checked read —
 * `ListTasksForGarden` returns every task in a garden, not one by id.
 * Mirrors `GetPlant`'s and `GetGarden`'s own shape exactly: authorize first,
 * against the path's own `gardenId`, then fetch by id and conceal both "no
 * such task" and "this task belongs to a different garden" as the identical
 * `taskNotFoundError`.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { taskNotFoundError } from './task-errors.js';
import type { TaskRepository } from './task-repository.js';
import { toTaskResource, type TaskResource } from './task-view.js';

export class GetTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, taskId: Uuid, profileId: Uuid): Promise<TaskResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const task = await this.tasks.findById(taskId);
    if (task === null || task.gardenId !== gardenId) {
      throw taskNotFoundError();
    }

    return toTaskResource(task);
  }
}
