/**
 * `apply-revision-guarded-update.ts`'s counterpart for tasks: fetch, check
 * `expectedRevision`, transform, write back guarded by the revision actually
 * observed — exactly gardens-mapping's own pattern
 * (`GardenRepository`/`applyRevisionGuardedUpdate`), retargeted to
 * `TaskRepository`, the same way plants-inventory's own
 * `apply-plant-revision-guarded-update.ts` is.
 *
 * Source: architecture/api-design.md, section "7. Optimistic Concurrency".
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Task } from '../domain/task.js';
import { taskNotFoundError, taskStaleRevisionError } from './task-errors.js';
import type { TaskRepository } from './task-repository.js';

export async function applyTaskRevisionGuardedUpdate(
  tasks: TaskRepository,
  taskId: Uuid,
  expectedRevision: number,
  transform: (task: Task) => Task,
): Promise<Task> {
  const task = await tasks.findById(taskId);
  if (task === null) {
    throw taskNotFoundError();
  }
  if (task.revision !== expectedRevision) {
    throw taskStaleRevisionError(task.revision);
  }

  const updated = transform(task);
  const applied = await tasks.update(updated, task.revision);
  if (!applied) {
    throw taskStaleRevisionError(task.revision);
  }

  return updated;
}
