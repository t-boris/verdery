/**
 * Marks a task `'dismissed'`.
 *
 * Precondition, and terminality: identical to `CompleteTask`'s own — only
 * legal while `status IN ('planned', 'suggested')`, via the same
 * `requireEditableStatus` gate. Once dismissed, no further `EditTask`,
 * `RescheduleTask`, `CompleteTask`, `DismissTask`, or `SkipTask` succeeds
 * against this task.
 *
 * `reason` is accepted for interface completeness but has no storage target
 * in the landed migration — see `CompleteTask`'s own doc comment on
 * `completionNote` for the identical rationale, which applies here verbatim.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { requireTaskAndAuthorize } from './require-task-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TaskRepository } from './task-repository.js';
import type { TaskResource } from './task-view.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';
import { transitionTaskStatus } from './transition-task-status.js';

const OPERATION = 'tasks.dismissTask';

export class DismissTask {
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
    reason: string | null | undefined,
    idempotencyKey: string,
  ): Promise<TaskResource> {
    await requireTaskAndAuthorize(this.tasks, this.authorization, taskId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ taskId, expectedRevision, reason: reason ?? null }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) =>
        transitionTaskStatus(
          context.tasks,
          context.revisionJournal,
          taskId,
          expectedRevision,
          'dismissed',
          'dismissTask',
          profileId,
          this.clock.now(),
        ),
    );
  }
}
