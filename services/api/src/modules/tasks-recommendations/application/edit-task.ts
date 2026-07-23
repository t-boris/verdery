/**
 * Revision-guarded general edit of a task's title, notes, schedule, urgency,
 * and recurrence rule.
 *
 * Only legal while `status IN ('planned', 'suggested')` — enforced by
 * `updateTaskDetails`'s own `requireEditableStatus` gate (see
 * `domain/task-lifecycle.ts`), which raises a typed `DomainRuleViolatedError`
 * rather than letting a stale-looking write fail some other, less specific
 * way. `recurrenceRule` is stored as opaque text only: no parsing,
 * expansion, or validation of its contents this pass.
 *
 * Shares its revision-guard/journal-append plumbing with `RescheduleTask`
 * through `applyTaskDetailChanges` — see that file's own doc comment for why
 * the two commands are kept as separate classes despite the shared
 * mechanics.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { TaskDetailChanges, TaskUrgency } from '../domain/task.js';
import { applyTaskDetailChanges } from './apply-task-detail-changes.js';
import { requireTaskAndAuthorize } from './require-task-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TaskRepository } from './task-repository.js';
import type { TaskResource } from './task-view.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';

const OPERATION = 'tasks.editTask';

export interface EditTaskTimeWindowInput {
  readonly start?: Date | null;
  readonly end?: Date | null;
}

export interface EditTaskChanges {
  readonly title?: string;
  readonly notes?: string | null;
  readonly dueDate?: string | null;
  readonly timeWindow?: EditTaskTimeWindowInput;
  readonly urgency?: TaskUrgency;
  readonly recurrenceRule?: string | null;
}

function toDetailChanges(changes: EditTaskChanges): TaskDetailChanges {
  return {
    title: changes.title,
    notes: changes.notes,
    dueDate: changes.dueDate,
    timeWindowStart: changes.timeWindow?.start,
    timeWindowEnd: changes.timeWindow?.end,
    urgency: changes.urgency,
    recurrenceRule: changes.recurrenceRule,
  };
}

export class EditTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    taskId: Uuid,
    profileId: Uuid,
    expectedRevision: number,
    changes: EditTaskChanges,
    idempotencyKey: string,
  ): Promise<TaskResource> {
    await requireTaskAndAuthorize(this.tasks, this.authorization, taskId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ taskId, expectedRevision, changes }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) =>
        applyTaskDetailChanges(
          context.tasks,
          context.revisionJournal,
          context.syncChanges,
          taskId,
          expectedRevision,
          toDetailChanges(changes),
          'editTask',
          profileId,
          this.clock.now(),
        ),
    );
  }
}
