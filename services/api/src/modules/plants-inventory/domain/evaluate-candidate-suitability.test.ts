import { describe, expect, it } from 'vitest';
import { evaluateCandidateSuitability } from './evaluate-candidate-suitability.js';
import type { CandidateSuitabilityFacts, GardenSuitabilityFacts } from './suitability-facts.js';
import type { SuitabilityRuleDefinition } from './suitability-rule-definition.js';

const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';

const GARDEN: GardenSuitabilityFacts = {
  gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c',
  sunExposure: 'full_sun',
  drainage: 'well_drained',
  growingContext: 'open_ground',
  region: null,
};

const CANDIDATE: CandidateSuitabilityFacts = {
  candidateId: CANDIDATE_ID,
  groupingKind: 'individual',
  quantity: null,
  profileFacts: [],
  distributionFacts: [],
};

function ruleReturning(
  axis: SuitabilityRuleDefinition['axis'],
  ruleKey: string,
  count: number,
): SuitabilityRuleDefinition {
  return {
    ruleKey,
    version: 1,
    axis,
    review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P11-SUIT-01' },
    evaluate: () =>
      Array.from({ length: count }, () => ({
        category: 'unknown' as const,
        axis,
        reason: 'plant_fact_missing' as const,
      })),
  };
}

describe('evaluateCandidateSuitability', () => {
  it('concatenates every rule’s findings into one result, in catalog order', () => {
    const rules = [ruleReturning('sun_exposure', 'a', 1), ruleReturning('drainage', 'b', 2)];

    const result = evaluateCandidateSuitability(CANDIDATE_ID, rules, GARDEN, CANDIDATE);

    expect(result.candidateId).toBe(CANDIDATE_ID);
    expect(result.findings).toHaveLength(3);
    expect(result.findings[0]?.axis).toBe('sun_exposure');
    expect(result.findings[1]?.axis).toBe('drainage');
    expect(result.findings[2]?.axis).toBe('drainage');
  });

  it('a rule producing no findings contributes nothing, without breaking others', () => {
    const rules = [ruleReturning('sun_exposure', 'a', 0), ruleReturning('drainage', 'b', 1)];

    const result = evaluateCandidateSuitability(CANDIDATE_ID, rules, GARDEN, CANDIDATE);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.axis).toBe('drainage');
  });

  it('an empty rule set produces an empty result, honestly — not an error', () => {
    const result = evaluateCandidateSuitability(CANDIDATE_ID, [], GARDEN, CANDIDATE);
    expect(result).toEqual({ candidateId: CANDIDATE_ID, findings: [] });
  });

  it('is deterministic: identical inputs produce a deeply equal result', () => {
    const rules = [ruleReturning('sun_exposure', 'a', 1)];
    const first = evaluateCandidateSuitability(CANDIDATE_ID, rules, GARDEN, CANDIDATE);
    const second = evaluateCandidateSuitability(CANDIDATE_ID, rules, GARDEN, CANDIDATE);
    expect(second).toEqual(first);
  });
});
