/**
 * Typed errors this module raises for its own aggregate.
 *
 * `ObservationErrorCode` is colocated here rather than added to
 * `@verdery/api-contracts` (`GardenErrorCode`'s and `MapErrorCode`'s home):
 * this module has no transport layer or OpenAPI operation this pass — see
 * `public.ts`'s doc comment — mirroring `media`'s own "no
 * `@verdery/api-contracts` schema to conform to yet" reasoning
 * (`media/application/media-record-view.ts`). There is no contract document
 * for a shared, dotted code to live next to yet; promote this into the
 * shared catalogue if and when a route is added. `SharedErrorCode.
 * RequestInvalid` is reused as-is for the two validation cases below, the
 * same way `map/application/assign-plant-to-target.ts`'s `invalidTarget()`
 * and `notAPlant()` do — a module-specific `details[].code` carries the
 * precise reason, not the top-level `code`.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { NotFoundError, ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export const ObservationErrorCode = {
  /** No observation exists at this ID. */
  NotFound: 'observation.not_found',
} as const;

export type ObservationErrorCode = (typeof ObservationErrorCode)[keyof typeof ObservationErrorCode];

export function observationNotFoundError(): NotFoundError {
  return new NotFoundError(ObservationErrorCode.NotFound, 'Observation not found.');
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
    'photoMediaIds must reference existing media records.',
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
