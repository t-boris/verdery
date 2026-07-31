/**
 * Typed errors this module raises for its own aggregate.
 *
 * `ObservationErrorCode` is colocated here rather than added to
 * `@verdery/api-contracts` (`GardenErrorCode`'s and `MapErrorCode`'s home):
 * mirroring `media`'s own "no `@verdery/api-contracts` schema to conform to
 * yet" reasoning (`media/application/media-record-view.ts`) from when this
 * module first had no transport layer at all — P4-CONTRACT-01 later landed
 * real HTTP routes (`transport/observation-routes.ts`) without migrating
 * these codes into the shared catalogue; promote them there if a future
 * pass needs cross-module reuse. `SharedErrorCode.RequestInvalid` is reused
 * as-is for the validation cases below, the same way `map/application/
 * assign-plant-to-target.ts`'s `invalidTarget()` and `notAPlant()` do — a
 * module-specific `details[].code` carries the precise reason, not the
 * top-level `code`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { NotFoundError, ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export const ObservationErrorCode = {
  /** No observation exists at this ID. */
  NotFound: 'observation.not_found',
  /** No image-analysis (health-suggestion) result exists at this ID (P11-HEALTH-01). */
  AnalysisResultNotFound: 'observation.analysis_result_not_found',
} as const;

export type ObservationErrorCode = (typeof ObservationErrorCode)[keyof typeof ObservationErrorCode];

export function observationNotFoundError(): NotFoundError {
  return new NotFoundError(ObservationErrorCode.NotFound, 'Observation not found.');
}

export function imageAnalysisResultNotFoundError(): NotFoundError {
  return new NotFoundError(
    ObservationErrorCode.AnalysisResultNotFound,
    'Health suggestion (image analysis result) not found.',
  );
}

export function plantNotInGardenError(): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'plantId must reference a plant that belongs to this garden.',
    { details: [{ code: 'observation.plant_not_in_garden', pointer: '/plantId' }] },
  );
}

export function photoMediaNotFoundError(mediaId: Uuid): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'photoMediaIds must reference existing media records in this garden.',
    {
      details: [
        {
          code: 'observation.photo_media_not_found',
          pointer: '/photoMediaIds',
          parameters: { mediaId },
        },
      ],
    },
  );
}

/** A real, same-garden media record that is not `available` — still uploading, rejected, or in the deletion pipeline (P6-RET-01's attach-versus-delete guard). */
export function photoMediaNotAvailableError(mediaId: Uuid): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'photoMediaIds must reference media whose upload has completed and is not being deleted.',
    {
      details: [
        {
          code: 'observation.photo_media_not_available',
          pointer: '/photoMediaIds',
          parameters: { mediaId },
        },
      ],
    },
  );
}
