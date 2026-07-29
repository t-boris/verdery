/**
 * Shared vocabulary for the reviewable suitability-fixture suite — see
 * README.md in this directory. Mirrors `tests/rule-fixtures/fixture-
 * support.ts`'s role for the recommendation engine.
 */

import type {
  CandidateSuitabilityFacts,
  GardenSuitabilityFacts,
  SuitabilityAssessmentResult,
} from '../../src/modules/plants-inventory/public.js';

export const CANDIDATE_ID = '019a2000-0000-7000-8000-00000000bb01';
export const GARDEN_ID = '019a2000-0000-7000-8000-00000000bb02';

export interface SuitabilityFixture {
  readonly name: string;
  readonly reviewNotes: string;
  readonly garden: GardenSuitabilityFacts;
  readonly candidate: CandidateSuitabilityFacts;
  readonly expected: SuitabilityAssessmentResult;
}

export function gardenFacts(
  overrides: Partial<GardenSuitabilityFacts> = {},
): GardenSuitabilityFacts {
  return {
    gardenId: GARDEN_ID,
    sunExposure: 'full_sun',
    drainage: 'well_drained',
    growingContext: 'open_ground',
    region: null,
    ...overrides,
  };
}

export function candidateFacts(
  overrides: Partial<CandidateSuitabilityFacts> = {},
): CandidateSuitabilityFacts {
  return {
    candidateId: CANDIDATE_ID,
    groupingKind: 'individual',
    quantity: null,
    profileFacts: [],
    distributionFacts: [],
    ...overrides,
  };
}
