/**
 * Shared revision-guard/journal-append logic for `CompleteTask`,
 * `DismissTask`, `SkipTask`, and `DeleteTask`: all four apply the identical
 * domain transition (`transitionTaskToTerminalStatus`, in
 * `domain/task-lifecycle.ts`) and the identical "guard the revision, apply
 * the change, journal it, return the view" plumbing — the four command
 * classes differ only in which `TaskTerminalStatus`/`commandType` they pass.
 *
 * `operation: 'upsert'` even for `DeleteTask` (target `'deleted'`): this
 * module has no hard-delete anywhere, only status transitions — see this
 * file's own `transitionTaskToTerminalStatus` doc comment ("'Delete' is
 * modeled the same way plants-inventory models it: a status transition
 * ..., never a hard DELETE") — so the row remains fully readable and this
 * stays a status upsert, never a sync tombstone, matching `SetPlantStatus`'s
 * identical reasoning for `'removed'`/`'dead'`.
 */

import type { SyncChangeRecorder } from '../../../platform/sync/sync-change-recorder.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaskTerminalStatus } from '../domain/task-lifecycle.js';
import { transitionTaskToTerminalStatus } from '../domain/task-lifecycle.js';
import { applyTaskRevisionGuardedUpdate } from './apply-task-revision-guarded-update.js';
import type { TaskCommandType, TaskRevisionJournalWriter } from './task-revision-journal-writer.js';
import type { TaskRepository } from './task-repository.js';
import { toTaskResource, type TaskResource } from './task-view.js';

export async function transitionTaskStatus(
  tasks: TaskRepository,
  revisionJournal: TaskRevisionJournalWriter,
  syncChanges: SyncChangeRecorder,
  taskId: Uuid,
  expectedRevision: number,
  target: TaskTerminalStatus,
  commandType: TaskCommandType,
  actorProfileId: Uuid,
  now: Date,
): Promise<TaskResource> {
  const updated = await applyTaskRevisionGuardedUpdate(tasks, taskId, expectedRevision, (task) =>
    transitionTaskToTerminalStatus(task, target, now),
  );

  await revisionJournal.record({
    taskId: updated.id,
    revision: updated.revision,
    commandType,
    status: updated.status,
    dueDate: null,
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
