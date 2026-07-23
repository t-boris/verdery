/**
 * Marks a task `'skipped'` — "not doing this occurrence," distinct from
 * `DismissTask`'s "not doing this at all" in intent, though both are
 * currently plain terminal transitions with no further data attached.
 *
 * Precondition and terminality: identical to `DismissTask`'s own — only
 * legal while `status IN ('planned', 'suggested')`, via the same
 * `requireEditableStatus` gate.
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

const OPERATION = 'tasks.skipTask';

export class SkipTask {
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
          taskId,
          expectedRevision,
          'skipped',
          'skipTask',
          profileId,
          this.clock.now(),
        ),
    );
  }
}
