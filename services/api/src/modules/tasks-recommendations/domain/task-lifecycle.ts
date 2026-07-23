/**
 * `status` transitions — split out of `task.ts` the same way gardens-mapping
 * splits `map-object-lifecycle.ts` out of `map-object.ts`, and plants-inventory
 * splits `plant-lifecycle.ts` out of `plant.ts`.
 *
 * Unlike `transitionMapObjectLifecycle` (a binary `active`/`deleted` toggle)
 * or `setPlantStatus` (which accepts a transition to any status, including
 * the one already held), a task's status transitions are gated: `'planned'`
 * and `'suggested'` are the only two statuses a task can be *changed from* —
 * every other status (`'completed'`, `'skipped'`, `'dismissed'`, `'deleted'`)
 * is terminal. This single gate, `requireEditableStatus`, is the one
 * precondition every mutating command in this module beyond creation shares:
 * `EditTask` and `RescheduleTask` (via `updateTaskDetails` in `task.ts`) call
 * it because editing a completed/dismissed/skipped/deleted task makes no
 * sense, and `CompleteTask`/`DismissTask`/`SkipTask`/`DeleteTask` (via
 * `transitionTaskToTerminalStatus` below) call it for the same reason: none
 * of these six commands should apply twice, or to a task any other one of
 * them already finished.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * comment on `tasks_recommendations.task`.
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Task } from './task.js';

export type TaskStatus =
  'planned' | 'suggested' | 'completed' | 'skipped' | 'dismissed' | 'deleted';

/** The only two statuses a task's status/details may still be changed from. */
const EDITABLE_STATUSES: ReadonlySet<TaskStatus> = new Set(['planned', 'suggested']);

/**
 * Throws when `task.status` is not `'planned'`/`'suggested'` — the shared
 * precondition documented on this file's own header comment. Every command
 * that changes `task` beyond `CreateManualTask` calls this, directly or (for
 * `EditTask`/`RescheduleTask`) through `updateTaskDetails`.
 */
export function requireEditableStatus(task: Task): void {
  if (!EDITABLE_STATUSES.has(task.status)) {
    throw new DomainRuleViolatedError(
      'tasks_recommendations.task.status_conflict',
      `This task cannot be changed while it is '${task.status}'.`,
    );
  }
}

/** The four statuses `CompleteTask`/`SkipTask`/`DismissTask`/`DeleteTask` each transition into — every one of them terminal, per this file's own header comment. */
export type TaskTerminalStatus = 'completed' | 'skipped' | 'dismissed' | 'deleted';

/**
 * Shared transition function for `CompleteTask`, `DismissTask`, `SkipTask`,
 * and `DeleteTask`: all four apply the identical precondition
 * (`requireEditableStatus`) and the identical shape of change (set `status`,
 * bump `revision`, stamp `updatedAt`), differing only in which terminal
 * status they set — so, like `setPlantStatus` serves every status value for
 * plants, one function serves all four here rather than four near-duplicate
 * ones. `completedAt` is set only for the `'completed'` target — every other
 * target leaves it as it was (always `null`, since it is otherwise never
 * written).
 *
 * "Delete" is modeled the same way plants-inventory models it: a status
 * transition (here, to `'deleted'`), never a hard `DELETE` — matching every
 * other "delete" in this codebase's Phase 3/4 modules.
 */
export function transitionTaskToTerminalStatus(
  task: Task,
  target: TaskTerminalStatus,
  now: Date,
): Task {
  requireEditableStatus(task);

  return {
    ...task,
    status: target,
    completedAt: target === 'completed' ? now : task.completedAt,
    revision: task.revision + 1,
    updatedAt: now,
  };
}
