/**
 * The read side of "shared activity history" (P9A-TASK-01, B14-B17):
 * `tasks_recommendations.task_revision` IS that history — the migration's
 * own comment on the column this work package added to it says so directly
 * ("Assignment HISTORY needs no table of its own: `task_revision` is
 * already the immutable journal of every accepted command against a task
 * ... It was missing only the assignee the command settled on"). No new
 * audit-adjacent table: every accepted command against a task — creation,
 * edits, reschedules, terminal transitions, assignment — already writes one
 * immutable row here, in the same transaction as the command's own `task`
 * write (`TaskRevisionJournalWriter`). This port is that journal's READ
 * side, the counterpart `TaskRevisionJournalWriter` never needed until a
 * surface (`GetTaskActivity`) had to read it back.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaskStatus } from '../domain/task-lifecycle.js';
import type { TaskCommandType } from './task-revision-journal-writer.js';

export interface TaskActivityEntry {
  readonly revision: number;
  readonly commandType: TaskCommandType;
  readonly actorProfileId: Uuid;
  /** Populated only for the entries that changed status — see `TaskRevisionJournalEntry.status`'s own doc comment. */
  readonly status: TaskStatus | null;
  /** Populated only for the entries that changed the due date. */
  readonly dueDate: string | null;
  /** Populated only for `commandType: 'assignTask'` entries — the assignee that command settled on, or `null` for an unassignment. */
  readonly assignedProfileId: Uuid | null;
  readonly recordedAt: Date;
}

export interface TaskActivityRepository {
  /** Every `task_revision` row for one task, oldest first (ascending `revision`, which is also the append order — `task_revision_task_id_revision_key` guarantees one row per revision). */
  listForTask(taskId: Uuid): Promise<TaskActivityEntry[]>;
}
