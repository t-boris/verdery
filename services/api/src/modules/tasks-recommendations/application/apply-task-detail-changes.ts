/**
 * Shared revision-guard/journal-append logic for `EditTask` and
 * `RescheduleTask`: both commands change only scheduling/detail fields (never
 * `status`), through the same domain function (`updateTaskDetails`, in
 * `domain/task.ts`), so the "guard the revision, apply the change, journal
 * it, return the view" plumbing lives once here instead of twice — the two
 * command classes differ only in which `TaskDetailChanges` they build from
 * their own input shape and which `commandType` they journal under.
 *
 * `dueDate` is journaled only when this specific command's `changes` touched
 * it (`changes.dueDate !== undefined`), matching `TaskRevisionJournalEntry.
 * dueDate`'s own "populated only when this command changed the field"
 * convention — `RescheduleTask` almost always sets this; `EditTask` only
 * when a caller happens to include `dueDate` among its changes.
 */

import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaskDetailChanges } from '../domain/task.js';
import { updateTaskDetails } from '../domain/task.js';
import { applyTaskRevisionGuardedUpdate } from './apply-task-revision-guarded-update.js';
import type { TaskCommandType, TaskRevisionJournalWriter } from './task-revision-journal-writer.js';
import type { TaskRepository } from './task-repository.js';
import { toTaskResource, type TaskResource } from './task-view.js';

export async function applyTaskDetailChanges(
  tasks: TaskRepository,
  revisionJournal: TaskRevisionJournalWriter,
  syncChanges: SyncChangeRecorder,
  taskId: Uuid,
  expectedRevision: number,
  changes: TaskDetailChanges,
  commandType: TaskCommandType,
  actorProfileId: Uuid,
  now: Date,
): Promise<TaskResource> {
  const updated = await applyTaskRevisionGuardedUpdate(tasks, taskId, expectedRevision, (task) =>
    updateTaskDetails(task, changes, now),
  );

  await revisionJournal.record({
    taskId: updated.id,
    revision: updated.revision,
    commandType,
    status: null,
    dueDate: changes.dueDate !== undefined ? updated.dueDate : null,
    actorProfileId,
  });
  await syncChanges.record({
    gardenId: updated.gardenId,
    recordId: updated.id,
    recordType: 'task',
    operation: 'upsert',
    recordRevision: updated.revision,
  });

  return toTaskResource(updated);
}
