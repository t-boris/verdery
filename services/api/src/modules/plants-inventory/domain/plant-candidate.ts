/**
 * The plant-candidate aggregate: a plant being considered for a garden, not
 * present in it. Mirrors `plant.ts`'s own shape closely — same
 * `GroupingKind`/quantity-validation rule, same optimistic-concurrency
 * `revision`, same placement-is-application-validated posture — but is a
 * genuinely separate aggregate, not a status value on `Plant`: excluded from
 * inventory counts, current-care tasks, and "what grows here" claims by
 * construction. See ADR-0016 section 1 and the migration's own header.
 *
 * `status` is a small, separate vocabulary from `PlantStatus`: a candidate
 * is `active` (still under consideration), `converted` (terminal — see
 * `candidate-conversion.ts`), `archived` (owner decided against it, kept for
 * history), or `rejected` (suitability ruled it out). None of `plant`'s
 * dormant/removed/dead apply to something never planted.
 *
 * Source: migrations/1787600000000_plant-candidates-and-conversion.sql,
 * `plants_inventory.plant_candidate`;
 * architecture/plant-intelligence-and-visual-journal.md, section
 * "3.3 Candidate".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { validateDisplayName, validateQuantityForGroupingKind } from './plant.js';
import type { GroupingKind } from './plant.js';

export type CandidateStatus = 'active' | 'converted' | 'archived' | 'rejected';
export type CandidatePriority = 'low' | 'medium' | 'high';

/** A candidate's proposed position on the garden map — both fields reference a `gardens_mapping.garden_object` in `candidate.gardenId`, validated by the application layer, never by this module directly (mirrors `PlantPlacement`). */
export interface CandidatePlacement {
  readonly proposedGardenAreaMapObjectId: Uuid | null;
  readonly proposedPlacementMapObjectId: Uuid | null;
}

/** A candidate's purchase facts. `priceAmount`/`priceCurrency` are paired: both set or both null, enforced by `plant_candidate_price_pair_check` and re-checked here so a bad pairing raises a clean `ValidationError` instead of a raw CHECK violation. */
export interface CandidatePurchaseFacts {
  readonly priceAmount: number | null;
  readonly priceCurrency: string | null;
  readonly purchaseSource: string | null;
}

export interface PlantCandidate {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly proposedGardenAreaMapObjectId: Uuid | null;
  readonly proposedPlacementMapObjectId: Uuid | null;
  readonly displayName: string;
  readonly taxonomyReferenceId: Uuid | null;
  readonly varietyLabel: string | null;
  readonly groupingKind: GroupingKind;
  readonly quantity: number | null;
  readonly status: CandidateStatus;
  readonly rationaleNote: string | null;
  readonly priority: CandidatePriority | null;
  readonly priceAmount: number | null;
  readonly priceCurrency: string | null;
  readonly purchaseSource: string | null;
  /** A single, deliberately narrow self-reference — see the migration's own header for why this is not a full alternatives-set model. */
  readonly alternativeToCandidateId: Uuid | null;
  readonly revision: number;
  readonly createdByProfileId: Uuid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Mirrors `plant.ts`'s own price-pairing intent: raised before the row reaches the database's `plant_candidate_price_pair_check`. */
export function validatePurchaseFacts(facts: CandidatePurchaseFacts): CandidatePurchaseFacts {
  if ((facts.priceAmount === null) !== (facts.priceCurrency === null)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'priceAmount and priceCurrency must both be set, or both be null.',
      {
        details: [
          { code: 'plants_inventory.plant_candidate.price.unpaired', pointer: '/priceAmount' },
        ],
      },
    );
  }
  if (facts.priceAmount !== null && facts.priceAmount < 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'priceAmount must not be negative.', {
      details: [
        { code: 'plants_inventory.plant_candidate.price.negative', pointer: '/priceAmount' },
      ],
    });
  }
  return facts;
}

export function createCandidate(
  id: Uuid,
  gardenId: Uuid,
  placement: CandidatePlacement,
  rawDisplayName: string,
  taxonomyReferenceId: Uuid | null,
  varietyLabel: string | null,
  groupingKind: GroupingKind,
  rawQuantity: number | null | undefined,
  rationaleNote: string | null,
  priority: CandidatePriority | null,
  purchaseFacts: CandidatePurchaseFacts,
  alternativeToCandidateId: Uuid | null,
  createdByProfileId: Uuid,
  now: Date,
): PlantCandidate {
  const validatedPurchaseFacts = validatePurchaseFacts(purchaseFacts);
  return {
    id,
    gardenId,
    proposedGardenAreaMapObjectId: placement.proposedGardenAreaMapObjectId,
    proposedPlacementMapObjectId: placement.proposedPlacementMapObjectId,
    displayName: validateDisplayName(rawDisplayName),
    taxonomyReferenceId,
    varietyLabel,
    groupingKind,
    quantity: validateQuantityForGroupingKind(groupingKind, rawQuantity),
    status: 'active',
    rationaleNote,
    priority,
    priceAmount: validatedPurchaseFacts.priceAmount,
    priceCurrency: validatedPurchaseFacts.priceCurrency,
    purchaseSource: validatedPurchaseFacts.purchaseSource,
    alternativeToCandidateId,
    revision: 1,
    createdByProfileId,
    createdAt: now,
    updatedAt: now,
  };
}

/** Fields `UpdateCandidateDetails` may change. `undefined` means "leave unchanged"; an explicit `null` clears a nullable field — the same convention `PlantDetailsChanges` uses. `groupingKind` is immutable, matching `Plant`. */
export interface CandidateDetailsChanges {
  readonly displayName?: string;
  readonly taxonomyReferenceId?: Uuid | null;
  readonly varietyLabel?: string | null;
  readonly quantity?: number | null;
  readonly rationaleNote?: string | null;
  readonly priority?: CandidatePriority | null;
  readonly priceAmount?: number | null;
  readonly priceCurrency?: string | null;
  readonly purchaseSource?: string | null;
}

export function updateCandidateDetails(
  candidate: PlantCandidate,
  changes: CandidateDetailsChanges,
  now: Date,
): PlantCandidate {
  const displayName =
    changes.displayName !== undefined
      ? validateDisplayName(changes.displayName)
      : candidate.displayName;
  const quantity =
    changes.quantity !== undefined
      ? validateQuantityForGroupingKind(candidate.groupingKind, changes.quantity)
      : candidate.quantity;
  const priceAmount =
    changes.priceAmount !== undefined ? changes.priceAmount : candidate.priceAmount;
  const priceCurrency =
    changes.priceCurrency !== undefined ? changes.priceCurrency : candidate.priceCurrency;
  const validatedPurchaseFacts = validatePurchaseFacts({
    priceAmount,
    priceCurrency,
    purchaseSource:
      changes.purchaseSource !== undefined ? changes.purchaseSource : candidate.purchaseSource,
  });

  return {
    ...candidate,
    displayName,
    taxonomyReferenceId:
      changes.taxonomyReferenceId !== undefined
        ? changes.taxonomyReferenceId
        : candidate.taxonomyReferenceId,
    varietyLabel:
      changes.varietyLabel !== undefined ? changes.varietyLabel : candidate.varietyLabel,
    quantity,
    rationaleNote:
      changes.rationaleNote !== undefined ? changes.rationaleNote : candidate.rationaleNote,
    priority: changes.priority !== undefined ? changes.priority : candidate.priority,
    priceAmount: validatedPurchaseFacts.priceAmount,
    priceCurrency: validatedPurchaseFacts.priceCurrency,
    purchaseSource: validatedPurchaseFacts.purchaseSource,
    revision: candidate.revision + 1,
    updatedAt: now,
  };
}

/** `status` transitions freely between `active`/`archived`/`rejected` — no ordering requirement, mirroring `setPlantStatus`. `'converted'` is never set here: only `convertCandidateToPlant` (candidate-conversion.ts) may reach it, as part of the conversion command's own transaction. */
export function setCandidateStatus(
  candidate: PlantCandidate,
  targetStatus: Exclude<CandidateStatus, 'converted'>,
  now: Date,
): PlantCandidate {
  return { ...candidate, status: targetStatus, revision: candidate.revision + 1, updatedAt: now };
}
