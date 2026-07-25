/**
 * Recommendation feedback: FR-24's "Completion, postponement, dismissal,
 * and relevance feedback controls" as an append-only trail with actor and
 * timestamp — the rows section 16's evaluation loop ("User outcomes feed
 * product quality analysis") and section 17's completion/postponement/
 * rejection measurements read. Append-only like
 * `observations_history.observation`: a feedback event happened; it is
 * never edited, so no update function exists here.
 *
 * The kind vocabulary is FR-24's control list (also the exact four verbs
 * P7-BE-01's work package names for its commands). The candidate STATE
 * vocabulary is section 6's — the pairing is `completed` -> `completed`,
 * `postponed` -> `postponed`, `dismissed` -> `rejected` (FR-24 says
 * "dismissal" where section 6's lifecycle says "rejected"), and
 * `irrelevant` -> no state of its own (the explicit quality signal that
 * accompanies or follows a dismissal). Wiring a feedback row to its
 * lifecycle transition is P7-BE-01's command layer, deliberately not
 * folded in here — these stay two pure, separately-testable pieces.
 *
 * Source: migrations/1785600000000_recommendations-baseline.sql,
 * `tasks_recommendations.recommendation_feedback`;
 * architecture/recommendations-and-ai.md, sections "16. Evaluation and
 * Release" and "17. Observability"; technical-specification.md, section
 * "FR-24: Recommendations".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

export type RecommendationFeedbackKind = 'completed' | 'postponed' | 'dismissed' | 'irrelevant';

export interface RecommendationFeedback {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly kind: RecommendationFeedbackKind;
  readonly actorProfileId: Uuid;
  /** Only for `kind: 'postponed'`, and nullable even then — no document names a default or required postponement horizon. */
  readonly postponedUntil: Date | null;
  readonly recordedAt: Date;
}

export interface CreateRecommendationFeedbackInput {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly kind: RecommendationFeedbackKind;
  readonly actorProfileId: Uuid;
  readonly postponedUntil: Date | null;
  readonly now: Date;
}

/**
 * Constructs a new, immutable feedback row. Mirrors the migration's
 * `recommendation_feedback_postponed_until_check` one level up: a
 * postponement horizon on any non-postponement feedback is rejected with a
 * clean `ValidationError` instead of a raw CHECK violation.
 */
export function createRecommendationFeedback(
  input: CreateRecommendationFeedbackInput,
): RecommendationFeedback {
  if (input.postponedUntil !== null && input.kind !== 'postponed') {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      "postponedUntil may only accompany 'postponed' feedback.",
      {
        details: [
          {
            code: 'tasks_recommendations.recommendation_feedback.postponed_until.misplaced',
            pointer: '/postponedUntil',
          },
        ],
      },
    );
  }

  return {
    id: input.id,
    candidateId: input.candidateId,
    kind: input.kind,
    actorProfileId: input.actorProfileId,
    postponedUntil: input.postponedUntil,
    recordedAt: input.now,
  };
}
