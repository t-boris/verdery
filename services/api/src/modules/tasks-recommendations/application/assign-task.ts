/**
 * Assigns, reassigns, or unassigns (`assigneeProfileId: null`) a task to an
 * active member of its own garden (P9A-TASK-01).
 *
 * docs/development/garden-capability-matrix.md, rows B14/B15: the ACTOR must
 * hold `editGardenContent` on the task's garden (owner or editor) — the same
 * gate `requireTaskAndAuthorize` already applies to every other task
 * mutation, reused here unchanged. The ASSIGNEE must independently hold that
 * same capability (row B14: "Assignee must hold `editGardenContent`;
 * assigning to a viewer is Denied for all actors" — row B16 names the same
 * rule from the other side: "A viewer cannot complete work, so a viewer
 * cannot hold an assignment"). Checked with the SAME `GardenAuthorization.
 * requireCapability` entry point every other capability check in this
 * codebase funnels through, just evaluated for the assignee's profile
 * instead of the caller's — this is the one capability vocabulary, not a
 * parallel one. A `NotFoundError`/`ForbiddenError` from that second check is
 * translated into `ineligibleAssigneeError()`: unlike the actor's own check,
 * this is a malformed REQUEST (a bad `assigneeProfileId`), not the caller's
 * own permission, so it must not read as "you are forbidden."
 *
 * CONCURRENT ASSIGNMENT: two actors racing to assign the same task to two
 * different people resolve through the task's own optimistic concurrency —
 * `applyTaskRevisionGuardedUpdate`'s `WHERE id = ? AND revision = ?`
 * conditional update, the exact mechanism `CompleteTask`/`EditTask`/every
 * other revision-guarded command already uses. No new locking: the loser's
 * conditional UPDATE matches zero rows and `taskStaleRevisionError` is
 * raised (HTTP 412), never a corrupted or merged task state. See
 * `tests/integration/tasks-recommendations.test.ts` for the proof against
 * two genuine concurrent Postgres transactions.
 *
 * REASSIGNMENT IS THE SAME OPERATION APPLIED AGAIN: one command handles
 * B14 (assign) and B15 (reassign/unassign) — there is no first-assignment
 * precondition, matching `assignTask`'s own domain doc comment.
 *
 * ACTIVITY HISTORY: every accepted assignment is journaled to
 * `task_revision` (`assignedProfileId` on the entry) — see
 * `task-revision-journal-writer.ts`'s own header for why this journal, not a
 * new table, is this module's "shared activity history."
 *
 * COLLABORATION NOTIFICATION INTENT: an actual (non-`null`) assignment
 * appends a `task.assigned` event to the transactional outbox, in the SAME
 * transaction as the assignment write — the identical "domain event through
 * the outbox" shape `EvaluateGardenRecommendations` established for
 * `recommendation.candidate_created`
 * (`@verdery/api-contracts`'s `task-events.ts` carries the full reasoning,
 * including why this event is emitted unclaimed, exactly as that one was
 * before P7-NOTIF-01 existed). An unassignment appends no event: there is no
 * one left to notify.
 */

import { TASK_ASSIGNED_EVENT_TYPE, type TaskAssignedEventPayload } from '@verdery/api-contracts';
import { ForbiddenError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { assignTask } from '../domain/task.js';
import { applyTaskRevisionGuardedUpdate } from './apply-task-revision-guarded-update.js';
import { ineligibleAssigneeError } from './task-errors.js';
import { requireTaskAndAuthorize } from './require-task-and-authorize.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TaskRepository } from './task-repository.js';
import { toTaskResource, type TaskResource } from './task-view.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';

const OPERATION = 'tasks.assignTask';

export class AssignTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    taskId: Uuid,
    actorProfileId: Uuid,
    expectedRevision: number,
    assigneeProfileId: Uuid | null,
    idempotencyKey: string,
  ): Promise<TaskResource> {
    const task = await requireTaskAndAuthorize(
      this.tasks,
      this.authorization,
      taskId,
      actorProfileId,
    );

    if (assigneeProfileId !== null) {
      try {
        await this.authorization.requireCapability(
          task.gardenId,
          assigneeProfileId,
          'editGardenContent',
        );
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof ForbiddenError) {
          throw ineligibleAssigneeError();
        }
        throw error;
      }
    }

    const idempotencyInput = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ taskId, expectedRevision, assigneeProfileId }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      200,
      async (context) => {
        const previousAssigneeProfileId = task.assignedProfileId;
        const now = this.clock.now();

        const updated = await applyTaskRevisionGuardedUpdate(
          context.tasks,
          taskId,
          expectedRevision,
          (current) => assignTask(current, assigneeProfileId, now),
        );

        await context.revisionJournal.record({
          taskId: updated.id,
          revision: updated.revision,
          commandType: 'assignTask',
          status: null,
          dueDate: null,
          assignedProfileId: updated.assignedProfileId,
          actorProfileId,
        });
        await context.syncChanges.record({
          gardenId: updated.gardenId,
          recordId: updated.id,
          recordType: 'task',
          operation: 'upsert',
          recordRevision: updated.revision,
        });

        if (assigneeProfileId !== null) {
          const payload: TaskAssignedEventPayload = {
            taskId: updated.id,
            gardenId: updated.gardenId,
            assigneeProfileId,
            previousAssigneeProfileId,
            assignedByProfileId: actorProfileId,
          };
          await context.outbox.append({
            eventType: TASK_ASSIGNED_EVENT_TYPE,
            aggregateType: 'task',
            aggregateId: updated.id,
            payload,
          });
        }

        return toTaskResource(updated);
      },
    );
  }
}
