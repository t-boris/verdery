import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';

/**
 * The task commands that write a `task_revision` row — every command that
 * changes `task` (all seven minus `AttachTaskFile`, which only touches
 * `task_attachment` and never bumps `task.revision`, the same carve-out
 * `PlantCommandType`'s own doc comment documents for `AttachPlantPhoto`).
 */
export type TaskCommandType =
  | 'createManualTask'
  | 'editTask'
  | 'rescheduleTask'
  | 'completeTask'
  | 'dismissTask'
  | 'skipTask'
  | 'deleteTask';

export interface TaskRevisionJournalEntry {
  readonly taskId: Uuid;
  readonly revision: number;
  readonly commandType: TaskCommandType;
  /** Nullable: populated only when this command changed the field — see the migration's own comment on `tasks_recommendations.task_revision`, and `plant_revision`'s identical convention. `createManualTask` always populates it (the task's initial status); the four terminal transitions populate it with their target status; `editTask`/`rescheduleTask` never do (status is not what they change). */
  readonly status: TaskStatus | null;
  /** Nullable, same convention: populated by `createManualTask` (the initial due date, possibly itself null) and by `editTask`/`rescheduleTask` only when `dueDate` was part of what changed; never populated by the four terminal transitions. */
  readonly dueDate: string | null;
  readonly actorProfileId: Uuid;
}

/**
 * Writes one immutable row to `tasks_recommendations.task_revision` per
 * accepted command, in the same transaction as the command's own `task`
 * write — mirrors `plants-inventory`'s `PlantRevisionJournalWriter` for
 * `plant_revision` exactly.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * comment on `tasks_recommendations.task_revision`.
 */
export interface TaskRevisionJournalWriter {
  record(entry: TaskRevisionJournalEntry): Promise<void>;
}
