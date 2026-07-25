import { describe, expect, it } from 'vitest';
import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
import type {
  NewRecommendationPriorityFactor,
  RecommendationPriorityFactor,
} from './recommendation-priority.js';
import {
  aggregatePriorityContributions,
  createRecommendationPriorityFactors,
  derivePriorityScoreFromStoredFactors,
  parseStoredPriorityFactorValue,
} from './recommendation-priority.js';

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

function storedFactor(
  factorKind: RecommendationPriorityFactor['factorKind'],
  factorValue: unknown,
): RecommendationPriorityFactor {
  return { id: FACTOR_ID, candidateId: CANDIDATE_ID, factorKind, factorValue, createdAt: NOW };
}

describe('aggregatePriorityContributions', () => {
  it('sums contributions and clamps into [0, 100] — the one shared write/read formula', () => {
    expect(aggregatePriorityContributions([])).toBe(0);
    expect(aggregatePriorityContributions([30, 25, 20])).toBe(75);
    expect(aggregatePriorityContributions([90, 90])).toBe(100);
    expect(aggregatePriorityContributions([-40, 10])).toBe(0);
  });
});

describe('parseStoredPriorityFactorValue', () => {
  it('parses the engine-persisted { contribution, basis } shape back', () => {
    expect(
      parseStoredPriorityFactorValue(CANDIDATE_ID, 'confidence', {
        contribution: 20,
        basis: { source: 'own_records' },
      }),
    ).toEqual({ contribution: 20, basis: { source: 'own_records' } });
  });

  it.each([
    ['a scalar', 12],
    ['a null', null],
    ['a missing contribution', { basis: {} }],
    ['a fractional contribution', { contribution: 1.5, basis: {} }],
    ['an out-of-bound contribution', { contribution: 101, basis: {} }],
    ['a missing basis', { contribution: 10 }],
    ['an array basis', { contribution: 10, basis: [] }],
  ])(
    'refuses %s loudly — only the engine writes these rows, so malformed means defect',
    (_label, value) => {
      expect(() => parseStoredPriorityFactorValue(CANDIDATE_ID, 'confidence', value)).toThrow(
        InternalError,
      );
    },
  );
});

describe('derivePriorityScoreFromStoredFactors', () => {
  it('re-derives the rank from stored rows alone — what the Today ordering reads', () => {
    const score = derivePriorityScoreFromStoredFactors(CANDIDATE_ID, [
      storedFactor('urgency_window', { contribution: 30, basis: {} }),
      storedFactor('plant_impact', { contribution: 25, basis: {} }),
      storedFactor('confidence', { contribution: 20, basis: {} }),
      storedFactor('task_overlap', { contribution: -15, basis: { openTaskIds: [] } }),
    ]);
    expect(score).toBe(60);
  });

  it('scores a factor-less candidate at the floor — no stored factor explains any rank above it', () => {
    expect(derivePriorityScoreFromStoredFactors(CANDIDATE_ID, [])).toBe(0);
  });
});
