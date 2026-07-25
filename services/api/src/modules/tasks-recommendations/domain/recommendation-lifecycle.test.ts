import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { RecommendationCandidate } from './recommendation-candidate.js';
import type { RecommendationCandidateState } from './recommendation-lifecycle.js';
import {
  completeRecommendationCandidate,
  expireRecommendationCandidate,
  markRecommendationCandidateEligible,
  postponeRecommendationCandidate,
  presentRecommendationCandidate,
  rejectRecommendationCandidate,
  supersedeRecommendationCandidate,
} from './recommendation-lifecycle.js';

const NOW = new Date('2026-07-24T12:00:00Z');
const PRESENTED_AT = new Date('2026-07-23T12:00:00Z');

const ALL_STATES: readonly RecommendationCandidateState[] = [
  'generated',
  'eligible',
  'presented',
  'completed',
  'postponed',
  'rejected',
  'expired',
  'superseded',
];

function candidate(overrides: Partial<RecommendationCandidate> = {}): RecommendationCandidate {
  return {
    id: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e01',
    gardenId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e02',
    targetKind: 'garden',
    targetGardenAreaMapObjectId: null,
    targetPlantId: null,
    careCategory: 'watering',
    ruleVersionId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e03',
    safetyTier: 'ordinary_care',
    state: 'generated',
    urgency: 'normal',
    windowStart: null,
    windowEnd: null,
    primaryEvidenceId: '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9e04',
    supersedesCandidateId: null,
    presentedAt: null,
    revision: 1,
    createdAt: new Date('2026-07-20T00:00:00Z'),
    updatedAt: new Date('2026-07-20T00:00:00Z'),
    ...overrides,
  };
}

/** A candidate in the given state, with `presentedAt` set whenever the state implies presentation happened — the shape the migration's timestamp CHECK admits. */
function candidateIn(state: RecommendationCandidateState): RecommendationCandidate {
  const presented =
    state === 'presented' || state === 'completed' || state === 'postponed' || state === 'rejected';
  return candidate({ state, presentedAt: presented ? PRESENTED_AT : null });
}

/** Asserts a transition accepts exactly `allowed` source states and rejects every other, exhaustively over all eight. */
function assertAcceptsExactly(
  transition: (source: RecommendationCandidate, now: Date) => RecommendationCandidate,
  allowed: readonly RecommendationCandidateState[],
  target: RecommendationCandidateState,
): void {
  for (const state of ALL_STATES) {
    const source = candidateIn(state);
    if (allowed.includes(state)) {
      const result = transition(source, NOW);
      expect(result.state, `from '${state}'`).toBe(target);
      expect(result.revision, `from '${state}'`).toBe(2);
      expect(result.updatedAt, `from '${state}'`).toBe(NOW);
    } else {
      expect(() => transition(source, NOW), `from '${state}'`).toThrow(DomainRuleViolatedError);
    }
  }
}

describe('markRecommendationCandidateEligible', () => {
  it('accepts exactly generated', () => {
    assertAcceptsExactly(markRecommendationCandidateEligible, ['generated'], 'eligible');
  });
});

describe('presentRecommendationCandidate', () => {
  it('accepts exactly eligible', () => {
    assertAcceptsExactly(presentRecommendationCandidate, ['eligible'], 'presented');
  });

  it('records presentedAt exactly once, at the transition', () => {
    const presented = presentRecommendationCandidate(candidateIn('eligible'), NOW);
    expect(presented.presentedAt).toBe(NOW);
  });
});

describe('completeRecommendationCandidate', () => {
  it('accepts exactly presented', () => {
    assertAcceptsExactly(completeRecommendationCandidate, ['presented'], 'completed');
  });

  it('preserves presentedAt', () => {
    const completed = completeRecommendationCandidate(candidateIn('presented'), NOW);
    expect(completed.presentedAt).toBe(PRESENTED_AT);
  });
});

describe('postponeRecommendationCandidate', () => {
  it('accepts exactly presented — postponed is terminal here; re-surfacing is a superseding new candidate', () => {
    assertAcceptsExactly(postponeRecommendationCandidate, ['presented'], 'postponed');
  });
});

describe('rejectRecommendationCandidate', () => {
  it('accepts exactly presented', () => {
    assertAcceptsExactly(rejectRecommendationCandidate, ['presented'], 'rejected');
  });
});

describe('expireRecommendationCandidate', () => {
  it('accepts every live state — the deliberately-added pre-presentation edges', () => {
    assertAcceptsExactly(
      expireRecommendationCandidate,
      ['generated', 'eligible', 'presented'],
      'expired',
    );
  });

  it('leaves presentedAt exactly as it was on both sides of presentation', () => {
    expect(expireRecommendationCandidate(candidateIn('eligible'), NOW).presentedAt).toBeNull();
    expect(expireRecommendationCandidate(candidateIn('presented'), NOW).presentedAt).toBe(
      PRESENTED_AT,
    );
  });
});

describe('supersedeRecommendationCandidate', () => {
  it('accepts every live state — regeneration replaces a candidate whether or not it was shown', () => {
    assertAcceptsExactly(
      supersedeRecommendationCandidate,
      ['generated', 'eligible', 'presented'],
      'superseded',
    );
  });

  it('never touches the superseded record evidence pointer or its own backward reference', () => {
    const prior = candidateIn('presented');
    const superseded = supersedeRecommendationCandidate(prior, NOW);
    expect(superseded.primaryEvidenceId).toBe(prior.primaryEvidenceId);
    expect(superseded.supersedesCandidateId).toBe(prior.supersedesCandidateId);
  });
});
