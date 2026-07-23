/**
 * Reschedules a task's `dueDate`/`timeWindow` only.
 *
 * A distinct command from `EditTask`, kept separate because task management
 * names rescheduling as a distinct first-class user action — but it shares
 * `EditTask`'s underlying domain update function (`updateTaskDetails`) and
 * the same revision-guard/journal-append plumbing through
 * `applyTaskDetailChanges`, rather than duplicating either: this command's
 * `TaskDetailChanges` simply leaves `title`/`notes`/`urgency`/`recurrenceRule`
 * `undefined`.
 *
 * Same status invariant as `EditTask`: only legal while
 * `status IN ('planned', 'suggested')`.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { TaskDetailChanges } from '../domain/task.js';
import { applyTaskDetailChanges } from './apply-task-detail-changes.js';
import { requireTaskAndAuthorize } from './require-task-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TaskRepository } from './task-repository.js';
import type { TaskResource } from './task-view.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';

const OPERATION = 'tasks.rescheduleTask';

export interface RescheduleTaskTimeWindowInput {
  readonly start?: Date | null;
  readonly end?: Date | null;
}

export interface RescheduleTaskInput {
  readonly dueDate?: string | null;
  readonly timeWindow?: RescheduleTaskTimeWindowInput;
}

function toDetailChanges(input: RescheduleTaskInput): TaskDetailChanges {
  return {
    dueDate: input.dueDate,
    timeWindowStart: input.timeWindow?.start,
    timeWindowEnd: input.timeWindow?.end,
  };
}

export class RescheduleTask {
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
    input: RescheduleTaskInput,
    idempotencyKey: string,
  ): Promise<TaskResource> {
    await requireTaskAndAuthorize(this.tasks, this.authorization, taskId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ taskId, expectedRevision, input }),
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
          taskId,
          expectedRevision,
          toDetailChanges(input),
          'rescheduleTask',
          profileId,
          this.clock.now(),
        ),
    );
  }
}
