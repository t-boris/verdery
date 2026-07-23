/**
 * Typed errors this module raises for its own aggregate.
 *
 * `TaskErrorCode` is colocated here rather than added to
 * `@verdery/api-contracts`, mirroring `PlantErrorCode`'s and
 * `ObservationErrorCode`'s own reasoning: this module has no transport layer
 * or OpenAPI operation this pass (see `public.ts`), so there is no contract
 * document for a shared, dotted code to live next to yet. Only the two cases
 * every revision-guarded lookup needs (`NotFound`, `StaleRevision`) are
 * listed here — the same restraint `PlantErrorCode` shows: a domain-layer-only
 * code, like `task-lifecycle.ts`'s own `'tasks_recommendations.task.status_conflict'`
 * or `task.ts`'s `'tasks_recommendations.task.title.blank'`, is inlined
 * directly where it is raised rather than centralized here, since the domain
 * layer must not import from `application/` (see `plant.ts`'s identical
 * choice for its own inline codes).
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import {
  NotFoundError,
  StaleRevisionError,
  ValidationError,
} from '../../../platform/errors/application-error.js';

export const TaskErrorCode = {
  /** No task exists at this ID, or the caller lacks the capability to see it. */
  NotFound: 'tasks_recommendations.task.not_found',
  /** The supplied `expectedRevision` no longer matches the task's stored revision. */
  StaleRevision: 'tasks_recommendations.task.stale_revision',
} as const;

export type TaskErrorCode = (typeof TaskErrorCode)[keyof typeof TaskErrorCode];

export function taskNotFoundError(): NotFoundError {
  return new NotFoundError(TaskErrorCode.NotFound, 'Task not found.');
}

export function taskStaleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    TaskErrorCode.StaleRevision,
    'The task changed before this command was applied.',
    { details: [{ code: 'tasks_recommendations.task.revision', parameters: { currentRevision } }] },
  );
}

/** A `gardenAreaMapObjectId`/`plantId` target reference that does not name a real, active object in the task's own garden — the same shape of gap `invalidPlantPlacementError` closes for plants-inventory's own analogous reference. */
export function invalidTaskTargetReferenceError(pointer: string): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    "This task's target must reference an existing, active object in its own garden.",
    { details: [{ code: 'tasks_recommendations.task.invalid_target_reference', pointer }] },
  );
}

/** An `originObservationId` that does not resolve via `GetObservation`, or resolves to an observation belonging to a different garden. */
export function invalidOriginObservationError(): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'originObservationId must reference an observation that belongs to this garden.',
    {
      details: [
        {
          code: 'tasks_recommendations.task.invalid_origin_observation',
          pointer: '/originObservationId',
        },
      ],
    },
  );
}

/** A `mediaId` that `MediaRepository.get` does not return. */
export function invalidMediaReferenceError(pointer: string): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'mediaId must reference an existing media record.',
    { details: [{ code: 'tasks_recommendations.task.invalid_media_reference', pointer }] },
  );
}
