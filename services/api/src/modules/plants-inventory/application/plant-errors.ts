/**
 * Typed errors this module raises, and the dotted codes that identify them.
 *
 * Mirrors the *file structure* of gardens-mapping's own
 * `application/map-object-errors.ts` (a small set of constructor functions,
 * one per error case a command handler needs) — but unlike `MapErrorCode` /
 * `GardenErrorCode`, which live in `@verdery/api-contracts` because
 * gardens-mapping already has a landed OpenAPI contract to keep those codes
 * in step with, `plants_inventory` has no contract yet (P4-CONTRACT-01 lands
 * after this work package). `PlantErrorCode` is colocated in this module
 * instead of added to the shared contracts package prematurely; a future
 * contract pass can promote these codes there the same way `garden.
 * geometry.stale_revision` was promoted for gardens-mapping's map endpoints.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
  StaleRevisionError,
  ValidationError,
} from '../../../platform/errors/application-error.js';

export const PlantErrorCode = {
  /** No plant exists at this ID, or the caller lacks the capability to see it. */
  NotFound: 'plants_inventory.plant.not_found',
  /** The supplied `expectedRevision` no longer matches the plant's stored revision. */
  StaleRevision: 'plants_inventory.plant.stale_revision',
  /** No `plant_photo` exists at this ID for this plant. */
  PhotoNotFound: 'plants_inventory.plant.photo_not_found',
  /** No `plant_identification` exists at this ID. */
  IdentificationNotFound: 'plants_inventory.plant.identification_not_found',
  /** A `plant_identification` row exists but belongs to a different plant. */
  IdentificationMismatch: 'plants_inventory.plant.identification_mismatch',
} as const;

export type PlantErrorCode = (typeof PlantErrorCode)[keyof typeof PlantErrorCode];

export function plantNotFoundError(): NotFoundError {
  return new NotFoundError(PlantErrorCode.NotFound, 'Plant not found.');
}

export function plantStaleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    PlantErrorCode.StaleRevision,
    'The plant changed before this command was applied.',
    { details: [{ code: 'plants_inventory.plant.revision', parameters: { currentRevision } }] },
  );
}

export function plantPhotoNotFoundError(): NotFoundError {
  return new NotFoundError(PlantErrorCode.PhotoNotFound, 'Plant photo not found.');
}

export function plantIdentificationNotFoundError(): NotFoundError {
  return new NotFoundError(
    PlantErrorCode.IdentificationNotFound,
    'Plant identification not found.',
  );
}

export function plantIdentificationMismatchError(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    PlantErrorCode.IdentificationMismatch,
    'This identification does not belong to the specified plant.',
  );
}

/** A `gardenAreaMapObjectId`/`placementMapObjectId` reference that does not name an active `garden_object` in the plant's own garden — the same shape of gap `requireGateReferencesExistingFence` closes for gardens-mapping's `gate.fenceObjectId`. */
export function invalidPlantPlacementError(pointer: string): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    "This placement must reference an existing, active map object in the plant's own garden.",
    { details: [{ code: 'plants_inventory.plant.invalid_placement', pointer }] },
  );
}

/** A `mediaId` that `MediaRepository.get` does not return. */
export function invalidMediaReferenceError(pointer: string): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'mediaId must reference an existing media record.',
    { details: [{ code: 'plants_inventory.plant.invalid_media_reference', pointer }] },
  );
}
