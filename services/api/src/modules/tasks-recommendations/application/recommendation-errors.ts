/**
 * Typed errors for the recommendation surface (P7-BE-01) — the exact
 * two-case restraint `task-errors.ts` documents for tasks: only the codes
 * every revision-guarded lookup needs live here; domain-layer codes (state
 * conflicts, validation) stay inlined where they are raised.
 */

import { NotFoundError, StaleRevisionError } from '../../../platform/errors/application-error.js';

export const RecommendationErrorCode = {
  /** No candidate exists at this ID, it belongs to a different garden than the path names, or the caller lacks the capability to see it — all concealed identically. */
  NotFound: 'tasks_recommendations.recommendation.not_found',
  /** The supplied `expectedRevision` no longer matches the candidate's stored revision. */
  StaleRevision: 'tasks_recommendations.recommendation.stale_revision',
} as const;

export type RecommendationErrorCode =
  (typeof RecommendationErrorCode)[keyof typeof RecommendationErrorCode];

export function recommendationNotFoundError(): NotFoundError {
  return new NotFoundError(RecommendationErrorCode.NotFound, 'Recommendation not found.');
}

export function recommendationStaleRevisionError(currentRevision: number): StaleRevisionError {
  return new StaleRevisionError(
    RecommendationErrorCode.StaleRevision,
    'The recommendation changed before this command was applied.',
    {
      details: [
        {
          code: 'tasks_recommendations.recommendation.revision',
          parameters: { currentRevision },
        },
      ],
    },
  );
}
