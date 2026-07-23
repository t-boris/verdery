/**
 * Fetches the task a task-scoped command targets, then authorizes the caller
 * against the garden that task belongs to.
 *
 * Every command in this module that receives only a `taskId` (not a
 * `gardenId`) — `EditTask`, `RescheduleTask`, `CompleteTask`, `DismissTask`,
 * `SkipTask`, `DeleteTask`, and `AttachTaskFile` — needs this same two-step
 * lookup before it can run its own idempotency/transaction flow, the exact
 * shape plants-inventory's own `require-plant-and-authorize.ts` establishes
 * for its own `plantId`-only commands: `GardenAuthorization.requireCapability`
 * needs a `gardenId`, and only the task row itself can supply one here.
 *
 * Runs against the pooled connection, not a transaction — the same
 * before-the-transaction placement `requirePlantAndAuthorize` uses, so a
 * caller lacking the capability never reaches the idempotency check or opens
 * a transaction at all.
 */

import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Task } from '../domain/task.js';
import { taskNotFoundError } from './task-errors.js';
import type { TaskRepository } from './task-repository.js';

export async function requireTaskAndAuthorize(
  tasks: TaskRepository,
  authorization: GardenAuthorization,
  taskId: Uuid,
  profileId: Uuid,
): Promise<Task> {
  const task = await tasks.findById(taskId);
  if (task === null) {
    throw taskNotFoundError();
  }

  await authorization.requireCapability(task.gardenId, profileId, 'editGardenContent');

  return task;
}
