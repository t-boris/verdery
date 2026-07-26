import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';

/**
 * The task commands that write a `task_revision` row — every command that
 * changes `task` (minus `AttachTaskFile`, which only touches
 * `task_attachment` and never bumps `task.revision`, the same carve-out
 * `PlantCommandType`'s own doc comment documents for `AttachPlantPhoto`).
 * `convertRecommendationToTask` (P7-BE-01) journals the converted task's
 * creation the way `createManualTask` journals a manual one. `assignTask`
 * (P9A-TASK-01) journals every assign/reassign/unassign — see this file's
 * own header comment on `assignedProfileId` for why this journal IS the
 * shared assignment activity history, not a separate table.
 */
export type TaskCommandType =
  | 'createManualTask'
  | 'editTask'
  | 'rescheduleTask'
  | 'completeTask'
  | 'dismissTask'
  | 'skipTask'
  | 'deleteTask'
  | 'convertRecommendationToTask'
  | 'assignTask';

export interface TaskRevisionJournalEntry {
  readonly taskId: Uuid;
  readonly revision: number;
  readonly commandType: TaskCommandType;
  /** Nullable: populated only when this command changed the field — see the migration's own comment on `tasks_recommendations.task_revision`, and `plant_revision`'s identical convention. `createManualTask` always populates it (the task's initial status); the four terminal transitions populate it with their target status; `editTask`/`rescheduleTask`/`assignTask` never do (status is not what they change). */
  readonly status: TaskStatus | null;
  /** Nullable, same convention: populated by `createManualTask` (the initial due date, possibly itself null) and by `editTask`/`rescheduleTask` only when `dueDate` was part of what changed; never populated by the four terminal transitions or by `assignTask`. */
  readonly dueDate: string | null;
  /**
   * Nullable, same convention (P9A-TASK-01) — populated ONLY by `assignTask`,
   * with the assignee it settled on (`null` for an unassignment). Every
   * other command leaves this `null`, the same way they leave `status`/
   * `dueDate` `null` when their own command did not touch that field. This
   * is the column the migration's own comment names as making "the journal
   * already ... the assignment HISTORY" — reading every row for one task
   * where `commandType = 'assignTask'`, in revision order, IS the shared
   * activity history of who was assigned this task and when (`GetTaskActivity`).
   */
  readonly assignedProfileId: Uuid | null;
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
