/**
 * Creates a manual task — `source` is always `'manual'`; this module has no
 * command that creates a `'suggested'` one, since the Recommendation entity
 * that would originate one does not exist yet (see the migration's own
 * comment on `task.origin_recommendation_id`'s deliberate absence).
 *
 * `originObservationId`, when given, is validated through
 * observations-history's own `GetObservation` use case (its exported read
 * path — see that module's `public.ts`), never through a hand-rolled
 * transaction-bound `ObservationRepository` here: it is the one sibling
 * reference this command validates *before* opening a transaction, using the
 * already-constructed `getObservation` instance the composition root injects
 * (built from the same pooled `observationRepository` app.ts's
 * observations-history wiring block already constructs) — see
 * `tasks-recommendations-unit-of-work.ts`'s own doc comment for why this one
 * reference is the exception to this module's usual in-transaction
 * sibling-validation shape. This is also the *only* command in this module
 * that ever sets `origin_observation_id` — see `Task.originObservationId`'s
 * own doc comment.
 */

import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { GetObservation } from '../../observations-history/public.js';
import type { TaskTarget, TaskTargetKind, TaskUrgency } from '../domain/task.js';
import { createTask } from '../domain/task.js';
import { invalidOriginObservationError } from './task-errors.js';
import { requireTaskTargetReferencesExist } from './require-task-target-references.js';
import { runIdempotentCommand } from './run-idempotent-command.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';
import { toTaskResource, type TaskResource } from './task-view.js';

const OPERATION = 'tasks.createManualTask';

export interface CreateManualTaskTargetInput {
  readonly kind: TaskTargetKind;
  readonly gardenAreaMapObjectId?: Uuid;
  readonly plantId?: Uuid;
}

export interface CreateManualTaskTimeWindowInput {
  readonly start?: Date | null;
  readonly end?: Date | null;
}

export interface CreateManualTaskInput {
  readonly target: CreateManualTaskTargetInput;
  readonly title: string;
  readonly notes?: string | null;
  readonly dueDate?: string | null;
  readonly timeWindow?: CreateManualTaskTimeWindowInput;
  readonly urgency?: TaskUrgency;
  /** Set only at task creation — see this file's own header comment. */
  readonly originObservationId?: Uuid | null;
}

function normalizedTarget(input: CreateManualTaskInput): TaskTarget {
  return {
    kind: input.target.kind,
    gardenAreaMapObjectId: input.target.gardenAreaMapObjectId ?? null,
    plantId: input.target.plantId ?? null,
  };
}

export class CreateManualTask {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly getObservation: GetObservation,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    profileId: Uuid,
    input: CreateManualTaskInput,
    idempotencyKey: string,
  ): Promise<TaskResource> {
    await this.authorization.requireCapability(gardenId, profileId, 'editGardenContent');

    const originObservationId = input.originObservationId ?? null;
    if (originObservationId !== null) {
      const observation = await this.getObservation.execute(originObservationId);
      if (observation === null || observation.gardenId !== gardenId) {
        throw invalidOriginObservationError();
      }
    }

    const idempotencyInput = {
      actorProfileId: profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, input }),
    };

    return runIdempotentCommand(
      this.idempotency,
      this.unitOfWork,
      idempotencyInput,
      201,
      async (context) => {
        const target = normalizedTarget(input);
        await requireTaskTargetReferencesExist(
          context.mapObjects,
          context.plants,
          gardenId,
          target,
        );

        const now = this.clock.now();
        const task = createTask({
          id: generateUuidV7(),
          gardenId,
          target,
          rawTitle: input.title,
          notes: input.notes ?? null,
          rawDueDate: input.dueDate ?? null,
          timeWindowStart: input.timeWindow?.start ?? null,
          timeWindowEnd: input.timeWindow?.end ?? null,
          urgency: input.urgency ?? 'normal',
          originObservationId,
          createdByProfileId: profileId,
          now,
        });

        await context.tasks.insert(task);
        await context.revisionJournal.record({
          taskId: task.id,
          revision: task.revision,
          commandType: 'createManualTask',
          status: task.status,
          dueDate: task.dueDate,
          actorProfileId: profileId,
        });

        return toTaskResource(task);
      },
    );
  }
}
