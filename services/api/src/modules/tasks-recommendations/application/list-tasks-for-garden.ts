/**
 * Lists every task in a garden, optionally restricted to a set of statuses —
 * a single-garden view; the "one consolidated view across gardens" concept
 * the requirements describe starts here but is out of Phase 4's own scope.
 *
 * Ordering: soonest-due first (`dueDate ASC`, undated tasks sorted after
 * every dated one — `NULLS LAST`), then by `urgency` descending
 * (`'urgent'` > `'high'` > `'normal'` > `'low'`) as the tiebreaker within a
 * due date (including the undated group, where it becomes the primary key),
 * then by `createdAt` ascending as a final, stable tiebreaker. This is a
 * judgment call (the migration and this work package specify no exact sort):
 * due date is what makes a task actionable *today*, so it leads; urgency
 * then orders same-day (or equally undated) work by how much it matters.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';
import type { TaskRepository } from './task-repository.js';
import { toTaskResource, type TaskResource } from './task-view.js';

export class ListTasksForGarden {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    statusFilter?: readonly TaskStatus[],
  ): Promise<TaskResource[]> {
    await this.authorization.requireCapability(gardenId, profileId, 'viewGarden');

    const tasks = await this.tasks.listForGarden(gardenId, statusFilter ?? null);
    return tasks.map(toTaskResource);
  }
}
