/**
 * Typed errors this module raises for candidate commands. Mirrors
 * `plant-errors.ts`'s own file structure and its reasoning for keeping
 * codes module-local rather than in `@verdery/api-contracts`: candidates
 * have no landed OpenAPI contract yet (that is `P11-API-01`'s job).
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import {
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
