/**
 * Marks a task `'completed'` and stamps `completedAt` with the injected
 * `Clock` — never `new Date()`.
 *
 * Precondition: only legal while `status IN ('planned', 'suggested')` — the
 * same gate `EditTask`/`RescheduleTask` use (`requireEditableStatus`, via
 * `transitionTaskToTerminalStatus`). A task cannot be completed twice, nor
 * from `'skipped'`/`'dismissed'`/`'deleted'`.
 *
 * Does **not** write to `observations_history` — recording an observation
 * from a completed task is a separate, client-issued `RecordObservation`
 * call the caller makes on its own if it wants one (see this module's own
 * `public.ts` and `RecordObservation`'s doc comment); this command never
 * reaches into that module's write path.
 *
 * `completionNote` is accepted for interface completeness — it is part of
 * this command's own specified signature — but has no storage target in the
 * landed migration: neither `task` nor `task_revision` carries a column for
 * it (contrast with `origin_observation_id`, which does exist on `task` and
 * is set by `CreateManualTask`). Persisting it would require a schema change
 * out of this module's scope to make unilaterally (this repository's own
 * rule: never change the architecture without approval). It is folded into
 * the idempotency fingerprint, so a retried request must still supply the
 * same value, but the value itself is otherwise inert this pass.
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

const OPERATION = 'tasks.completeTask';

export class CompleteTask {
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
    completionNote: string | null | undefined,
    idempotencyKey: string,
  ): Promise<TaskResource> {
    await requireTaskAndAuthorize(this.tasks, this.authorization, taskId, profileId);

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({
        taskId,
        expectedRevision,
        completionNote: completionNote ?? null,
      }),
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
          'completed',
          'completeTask',
          profileId,
          this.clock.now(),
        ),
    );
  }
}
