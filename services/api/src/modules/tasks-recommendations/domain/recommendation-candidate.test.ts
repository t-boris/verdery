import { describe, expect, it } from 'vitest';
import {
  DomainRuleViolatedError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type {
  CreateRecommendationCandidateInput,
  RecommendationTarget,
} from './recommendation-candidate.js';
import {
  createRecommendationCandidate,
  requireGeneratableSafetyTier,
  validateCareCategory,
  validateRecommendationTarget,
  validateRecommendationWindow,
} from './recommendation-candidate.js';
import type { NewRecommendationEvidence } from './recommendation-evidence.js';

const NOW = new Date('2026-07-24T12:00:00Z');
const LATER = new Date('2026-07-25T12:00:00Z');
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d01';
const GARDEN_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d02';
const RULE_VERSION_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d03';
const GARDEN_AREA_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d04';
const PLANT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d05';
const EVIDENCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d06';
const SECOND_EVIDENCE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d07';
const PRIOR_CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9d08';

const GARDEN_TARGET: RecommendationTarget = {
  kind: 'garden',
  gardenAreaMapObjectId: null,
  plantId: null,
};

function evidenceItem(
  overrides: Partial<NewRecommendationEvidence> = {},
): NewRecommendationEvidence {
  return {
    id: EVIDENCE_ID,
    kind: 'garden_context',
    sourceObservationId: null,
    sourceTaskId: null,
    sourcePlantId: null,
    sourceWeatherRecordId: null,
    rawFactKey: 'garden.season',
    factValue: 'summer',
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<CreateRecommendationCandidateInput> = {},
): CreateRecommendationCandidateInput {
  return {
    id: CANDIDATE_ID,
    gardenId: GARDEN_ID,
    target: GARDEN_TARGET,
    rawCareCategory: 'watering',
    ruleVersionId: RULE_VERSION_ID,
    ruleSafetyTier: 'ordinary_care',
    urgency: 'normal',
    windowStart: null,
    windowEnd: null,
    supersedesCandidateId: null,
    evidence: [evidenceItem()],
    now: NOW,
    ...overrides,
  };
}

describe('validateRecommendationTarget', () => {
  it('accepts each of the three consistent target shapes', () => {
    expect(validateRecommendationTarget(GARDEN_TARGET)).toEqual(GARDEN_TARGET);
    const areaTarget: RecommendationTarget = {
      kind: 'garden_area',
      gardenAreaMapObjectId: GARDEN_AREA_ID,
      plantId: null,
    };
    expect(validateRecommendationTarget(areaTarget)).toEqual(areaTarget);
    const plantTarget: RecommendationTarget = {
      kind: 'plant',
      gardenAreaMapObjectId: null,
      plantId: PLANT_ID,
    };
    expect(validateRecommendationTarget(plantTarget)).toEqual(plantTarget);
  });

  it('rejects inconsistent targets, mirroring recommendation_candidate_target_consistency_check', () => {
    expect(() =>
      validateRecommendationTarget({
        kind: 'garden',
        gardenAreaMapObjectId: null,
        plantId: PLANT_ID,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      validateRecommendationTarget({
        kind: 'garden_area',
        gardenAreaMapObjectId: null,
        plantId: null,
      }),
    ).toThrow(ValidationError);
    expect(() =>
      validateRecommendationTarget({
        kind: 'plant',
        gardenAreaMapObjectId: GARDEN_AREA_ID,
        plantId: PLANT_ID,
      }),
    ).toThrow(ValidationError);
  });
});

describe('validateCareCategory', () => {
  it('trims and accepts a category, and rejects blank or overlong ones', () => {
    expect(validateCareCategory('  watering ')).toBe('watering');
    expect(() => validateCareCategory('   ')).toThrow(ValidationError);
    expect(() => validateCareCategory('c'.repeat(101))).toThrow(ValidationError);
  });
});

describe('validateRecommendationWindow', () => {
  it('accepts open, half-open, and ordered windows', () => {
    expect(() => validateRecommendationWindow(null, null)).not.toThrow();
    expect(() => validateRecommendationWindow(NOW, null)).not.toThrow();
    expect(() => validateRecommendationWindow(null, NOW)).not.toThrow();
    expect(() => validateRecommendationWindow(NOW, LATER)).not.toThrow();
    expect(() => validateRecommendationWindow(NOW, NOW)).not.toThrow();
  });

  it('rejects a window that ends before it starts', () => {
    expect(() => validateRecommendationWindow(LATER, NOW)).toThrow(ValidationError);
  });
});

describe('requireGeneratableSafetyTier', () => {
  it('accepts ordinary_care and elevated_risk', () => {
    expect(() => requireGeneratableSafetyTier('ordinary_care')).not.toThrow();
    expect(() => requireGeneratableSafetyTier('elevated_risk')).not.toThrow();
  });

  it('rejects restricted — section 13 exclusion, the domain half of the migration CHECK', () => {
    expect(() => requireGeneratableSafetyTier('restricted')).toThrow(DomainRuleViolatedError);
  });
});

describe('createRecommendationCandidate', () => {
  it('creates a generated candidate whose evidence is bound to it, first item primary', () => {
    const { candidate, evidence } = createRecommendationCandidate(
      baseInput({
        evidence: [
          evidenceItem(),
          evidenceItem({
            id: SECOND_EVIDENCE_ID,
            kind: 'soil_moisture',
            rawFactKey: 'soil.moisture',
          }),
        ],
      }),
    );

    expect(candidate).toMatchObject({
      id: CANDIDATE_ID,
      gardenId: GARDEN_ID,
      targetKind: 'garden',
      careCategory: 'watering',
      ruleVersionId: RULE_VERSION_ID,
      safetyTier: 'ordinary_care',
      state: 'generated',
      urgency: 'normal',
      primaryEvidenceId: EVIDENCE_ID,
      supersedesCandidateId: null,
      presentedAt: null,
      revision: 1,
    });
    expect(candidate.createdAt).toBe(NOW);
    expect(candidate.updatedAt).toBe(NOW);

    expect(evidence).toHaveLength(2);
    expect(evidence.every((item) => item.candidateId === CANDIDATE_ID)).toBe(true);
    expect(evidence[0]?.id).toBe(EVIDENCE_ID);
    expect(evidence[1]?.id).toBe(SECOND_EVIDENCE_ID);
  });

  it('rejects an empty evidence list — the domain half of the deferred primary-evidence FK', () => {
    expect(() => createRecommendationCandidate(baseInput({ evidence: [] }))).toThrow(
      ValidationError,
    );
  });

  it('rejects an inconsistent evidence item, naming its list index', () => {
    try {
      createRecommendationCandidate(
        baseInput({
          evidence: [evidenceItem(), evidenceItem({ id: SECOND_EVIDENCE_ID, kind: 'observation' })],
        }),
      );
      expect.unreachable('expected a ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details?.[0]?.pointer).toBe('/evidence/1');
    }
  });

  it('rejects a restricted-tier rule at construction', () => {
    expect(() =>
      createRecommendationCandidate(baseInput({ ruleSafetyTier: 'restricted' })),
    ).toThrow(DomainRuleViolatedError);
  });

  it('rejects an inconsistent target and an inverted window at construction', () => {
    expect(() =>
      createRecommendationCandidate(
        baseInput({ target: { kind: 'plant', gardenAreaMapObjectId: null, plantId: null } }),
      ),
    ).toThrow(ValidationError);
    expect(() =>
      createRecommendationCandidate(baseInput({ windowStart: LATER, windowEnd: NOW })),
    ).toThrow(ValidationError);
  });

  it('carries a supersession reference through, but rejects self-supersession', () => {
    const { candidate } = createRecommendationCandidate(
      baseInput({ supersedesCandidateId: PRIOR_CANDIDATE_ID }),
    );
    expect(candidate.supersedesCandidateId).toBe(PRIOR_CANDIDATE_ID);

    expect(() =>
      createRecommendationCandidate(baseInput({ supersedesCandidateId: CANDIDATE_ID })),
    ).toThrow(ValidationError);
  });
});
