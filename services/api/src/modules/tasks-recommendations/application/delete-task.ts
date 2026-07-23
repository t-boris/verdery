/**
 * Marks a task `'deleted'`. No hard delete — matches every other "delete" in
 * this codebase's Phase 3/4 modules (`SetPlantStatus('removed'/'dead')`,
 * `DeleteMapObject`'s soft `lifecycle_state → 'deleted'`) being a
 * status/lifecycle transition, never a row removal.
 *
 * Precondition and terminality: identical to `SkipTask`'s own — only legal
 * while `status IN ('planned', 'suggested')`, via the same
 * `requireEditableStatus` gate, so a task cannot be "deleted" twice or after
 * it was already completed/skipped/dismissed.
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

const OPERATION = 'tasks.deleteTask';

export class DeleteTask {
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
    idempotencyKey: string,
  ): Promise<TaskResource> {
    await requireTaskAndAuthorize(this.tasks, this.authorization, taskId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ taskId, expectedRevision }),
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
          context.syncChanges,
          taskId,
          expectedRevision,
          'deleted',
          'deleteTask',
          profileId,
          this.clock.now(),
        ),
    );
  }
}
