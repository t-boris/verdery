/**
 * Typed errors this module raises for candidate commands. Mirrors
 * `plant-errors.ts`'s own file structure; codes stay module-local rather
 * than in `@verdery/api-contracts`, the same reasoning `PlantErrorCode`'s
 * own header gives for `plants_inventory` generally — a future contract
 * pass can promote these the same way `garden.geometry.stale_revision`
 * was promoted for gardens-mapping's map endpoints.
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import {
  DependencyUnavailableError,
  DomainRuleViolatedError,
  NotFoundError,
  StaleRevisionError,
  ValidationError,
} from '../../../platform/errors/application-error.js';

export const CandidateErrorCode = {
  /** No candidate exists at this ID, or the caller lacks the capability to see it. */
  NotFound: 'plants_inventory.plant_candidate.not_found',
  /** The supplied `expectedRevision` no longer matches the candidate's stored revision. */
  StaleRevision: 'plants_inventory.plant_candidate.stale_revision',
  /** No suitability assessment has ever been computed for this candidate. */
  SuitabilityNotFound: 'plants_inventory.plant_candidate.suitability_not_found',
} as const;

export type CandidateErrorCode = (typeof CandidateErrorCode)[keyof typeof CandidateErrorCode];

export function candidateNotFoundError(): NotFoundError {
  return new NotFoundError(CandidateErrorCode.NotFound, 'Plant candidate not found.');
}

export function candidateStaleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    CandidateErrorCode.StaleRevision,
    'The candidate changed before this command was applied.',
    {
      details: [
        { code: 'plants_inventory.plant_candidate.revision', parameters: { currentRevision } },
      ],
    },
  );
}

/** A `proposedGardenAreaMapObjectId`/`proposedPlacementMapObjectId` reference that does not name an active `garden_object` in the candidate's own garden — mirrors `invalidPlantPlacementError`. */
export function invalidCandidatePlacementError(pointer: string): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    "This placement must reference an existing, active map object in the candidate's own garden.",
    { details: [{ code: 'plants_inventory.plant_candidate.invalid_placement', pointer }] },
  );
}

/** A conversion race lost against another concurrent conversion of the same candidate — the `candidate_conversion_candidate_id_key` unique-violation surfaced as a typed, catchable error instead of a raw database error. */
export function candidateAlreadyConvertedError(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    'plants_inventory.plant_candidate.already_converted',
    'This candidate has already been converted to a plant.',
  );
}

/** `GetCandidateSuitability`'s honest 404 when `RecalculateCandidateSuitability` has never run for this candidate — never a fabricated empty assessment. */
export function candidateSuitabilityNotFoundError(): NotFoundError {
  return new NotFoundError(
    CandidateErrorCode.SuitabilityNotFound,
    'No suitability assessment has been computed for this candidate yet.',
  );
}

/** `AddCandidateFromPhoto`'s own media-reference guard — mirrors `invalidMediaReferenceError` in `plant-errors.ts`. */
export function invalidCandidateMediaReferenceError(pointer: string): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'mediaId must reference an existing media record in this garden.',
    { details: [{ code: 'plants_inventory.plant_candidate.invalid_media_reference', pointer }] },
  );
}

/** Mirrors `mediaNotAvailableForAttachmentError` in `plant-errors.ts`. */
export function candidateMediaNotAvailableForAttachmentError(pointer: string): ValidationError {
  return new ValidationError(
    SharedErrorCode.RequestInvalid,
    'mediaId must reference media whose upload has completed and is not being deleted.',
    { details: [{ code: 'plants_inventory.plant_candidate.media_not_available', pointer }] },
  );
}

export function candidateIdentificationSourceNotReadyError(): DependencyUnavailableError {
  return new DependencyUnavailableError(
    'plants_inventory.plant_candidate.identification_source_not_ready',
    'The photo is still being prepared for identification. Try again shortly.',
  );
}

export function candidateIdentificationNoPhotoError(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    'plants_inventory.plant_candidate.identification_photo_missing',
    'This candidate has no photo to identify.',
  );
}

export function candidateIdentificationNoMatchError(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    'plants_inventory.plant_candidate.identification_no_confident_match',
    'The plant could not be identified confidently from this photo.',
  );
}
