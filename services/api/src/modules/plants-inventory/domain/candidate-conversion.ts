/**
 * Candidate conversion: the explicit, revision-aware transformation of a
 * `PlantCandidate` into a real `Plant`. Pure domain logic only — the
 * application command (`application/convert-candidate.ts`) owns the
 * idempotency/transaction/at-most-once-per-candidate enforcement described
 * in the migration's own header.
 *
 * Source: architecture/plant-intelligence-and-visual-journal.md, section
 * "3.4 Candidate Conversion".
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AcquisitionDateType, Plant, PlantPlacement } from './plant.js';
import { createPlant } from './plant.js';
import type { PlantCandidate } from './plant-candidate.js';

export interface CandidateConversion {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly plantId: Uuid;
  readonly convertedByProfileId: Uuid;
  readonly convertedAt: Date;
}

/** Dotted code identifying this module's one domain-level error, mirroring `PlantErrorCode`'s own local (not `SharedErrorCode`) convention for a state conflict rather than a request-shape violation. */
export const CANDIDATE_NOT_CONVERTIBLE_CODE = 'plants_inventory.plant_candidate.not_convertible';

/** Only an `active` candidate may convert — not already converted, archived, or rejected. Structurally the SAME rule the `candidate_conversion` unique constraint enforces at the storage layer; this is the pre-write check that raises a clean, typed error instead of a raw unique-violation on the rare true race (which `ConvertCandidate` still must handle — see that file). */
export function requireConvertibleCandidate(candidate: PlantCandidate): void {
  if (candidate.status !== 'active') {
    throw new DomainRuleViolatedError(
      CANDIDATE_NOT_CONVERTIBLE_CODE,
      `A candidate with status '${candidate.status}' cannot be converted.`,
      {
        details: [
          {
            code: 'plants_inventory.plant_candidate.not_convertible',
            parameters: { status: candidate.status },
          },
        ],
      },
    );
  }
}

/**
 * Builds the new actual plant from a convertible candidate. `placement`
 * defaults to the candidate's own proposed placement when the caller does
 * not supply a final one — "Creates the actual plant identity and accepted
 * placement" (design doc section 3.4) allows the accepted placement to
 * differ from what was merely proposed, since conversion is the moment the
 * user confirms exactly where the plant went in. `acquisitionDate`/
 * `acquisitionDateType` are new facts established at conversion time — a
 * candidate carries no acquisition date of its own, since it was never
 * acquired. The new plant's `createdByProfileId` is the profile performing
 * the conversion, not necessarily the candidate's original proposer — one
 * collaborator may propose a candidate another later plants and converts.
 */
export function convertCandidateToPlant(
  newPlantId: Uuid,
  candidate: PlantCandidate,
  placement: PlantPlacement,
  acquisitionDate: string | null,
  acquisitionDateType: AcquisitionDateType | null,
  convertedByProfileId: Uuid,
  now: Date,
): Plant {
  requireConvertibleCandidate(candidate);

  return createPlant(
    newPlantId,
    candidate.gardenId,
    placement,
    candidate.displayName,
    candidate.taxonomyReferenceId,
    candidate.varietyLabel,
    acquisitionDate,
    acquisitionDateType,
    candidate.groupingKind,
    candidate.quantity,
    convertedByProfileId,
    now,
  );
}

/** Flips a convertible candidate to its one terminal, otherwise-unreachable status. Only this function may produce `status: 'converted'` — `setCandidateStatus` (`plant-candidate.ts`) explicitly excludes it from its own target type. */
export function markCandidateConverted(candidate: PlantCandidate, now: Date): PlantCandidate {
  requireConvertibleCandidate(candidate);
  return { ...candidate, status: 'converted', revision: candidate.revision + 1, updatedAt: now };
}
