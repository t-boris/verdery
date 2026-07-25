import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CreateRecommendationFeedbackInput } from './recommendation-feedback.js';
import { createRecommendationFeedback } from './recommendation-feedback.js';

const NOW = new Date('2026-07-24T12:00:00Z');
const POSTPONED_UNTIL = new Date('2026-07-30T08:00:00Z');
const FEEDBACK_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8fa001';
const CANDIDATE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8fa002';
const ACTOR_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8fa003';

function input(
  overrides: Partial<CreateRecommendationFeedbackInput> = {},
): CreateRecommendationFeedbackInput {
  return {
    id: FEEDBACK_ID,
    candidateId: CANDIDATE_ID,
    kind: 'completed',
    actorProfileId: ACTOR_ID,
    postponedUntil: null,
    now: NOW,
    ...overrides,
  };
}

describe('createRecommendationFeedback', () => {
  it('records each of the four FR-24 feedback kinds with actor and timestamp', () => {
    for (const kind of ['completed', 'postponed', 'dismissed', 'irrelevant'] as const) {
      const feedback = createRecommendationFeedback(input({ kind }));
      expect(feedback).toEqual({
        id: FEEDBACK_ID,
        candidateId: CANDIDATE_ID,
        kind,
        actorProfileId: ACTOR_ID,
        postponedUntil: null,
        recordedAt: NOW,
      });
    }
  });

  it('carries a postponement horizon on postponed feedback, and allows postponing without one', () => {
    const withHorizon = createRecommendationFeedback(
      input({ kind: 'postponed', postponedUntil: POSTPONED_UNTIL }),
    );
    expect(withHorizon.postponedUntil).toBe(POSTPONED_UNTIL);

    const withoutHorizon = createRecommendationFeedback(input({ kind: 'postponed' }));
    expect(withoutHorizon.postponedUntil).toBeNull();
  });

  it('rejects a postponement horizon on any other kind, mirroring the migration CHECK', () => {
    for (const kind of ['completed', 'dismissed', 'irrelevant'] as const) {
      expect(() =>
        createRecommendationFeedback(input({ kind, postponedUntil: POSTPONED_UNTIL })),
      ).toThrow(ValidationError);
    }
  });
});
