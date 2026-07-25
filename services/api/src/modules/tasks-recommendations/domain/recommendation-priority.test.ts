import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { NewRecommendationPriorityFactor } from './recommendation-priority.js';
import { createRecommendationPriorityFactors } from './recommendation-priority.js';

const NOW = new Date('2026-07-24T12:00:00Z');
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9f01';
const FACTOR_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9f02';
const SECOND_FACTOR_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9f03';

function factor(
  overrides: Partial<NewRecommendationPriorityFactor> = {},
): NewRecommendationPriorityFactor {
  return {
    id: FACTOR_ID,
    factorKind: 'urgency_window',
    factorValue: { daysRemaining: 2 },
    ...overrides,
  };
}

describe('createRecommendationPriorityFactors', () => {
  it('binds each factor to the candidate with the recorded time', () => {
    const factors = createRecommendationPriorityFactors(
      CANDIDATE_ID,
      [factor(), factor({ id: SECOND_FACTOR_ID, factorKind: 'confidence', factorValue: 'high' })],
      NOW,
    );

    expect(factors).toEqual([
      {
        id: FACTOR_ID,
        candidateId: CANDIDATE_ID,
        factorKind: 'urgency_window',
        factorValue: { daysRemaining: 2 },
        createdAt: NOW,
      },
      {
        id: SECOND_FACTOR_ID,
        candidateId: CANDIDATE_ID,
        factorKind: 'confidence',
        factorValue: 'high',
        createdAt: NOW,
      },
    ]);
  });

  it('accepts an empty list — factors are optional per candidate, unlike evidence', () => {
    expect(createRecommendationPriorityFactors(CANDIDATE_ID, [], NOW)).toEqual([]);
  });

  it('rejects a duplicated factor kind, mirroring the candidate/kind UNIQUE', () => {
    expect(() =>
      createRecommendationPriorityFactors(
        CANDIDATE_ID,
        [factor(), factor({ id: SECOND_FACTOR_ID })],
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  it('rejects an undefined value, mirroring the column NOT NULL', () => {
    expect(() =>
      createRecommendationPriorityFactors(CANDIDATE_ID, [factor({ factorValue: undefined })], NOW),
    ).toThrow(ValidationError);
  });
});
