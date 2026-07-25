/**
 * `state` transitions for recommendation candidates — split out of
 * `recommendation-candidate.ts` the same way this module splits
 * `task-lifecycle.ts` out of `task.ts`, and shaped like
 * `media/domain/media-lifecycle.ts`: every transition function rejects a
 * source state it does not expect, never a permissive setter.
 *
 * The machine is section 6's diagram read literally:
 *
 *   generated -> eligible -> presented -> completed
 *                            |----------> postponed
 *                            |----------> rejected
 *                            |----------> expired
 *                            '----------> superseded
 *
 * Two edges are deliberately ADDED beyond what the diagram draws — added
 * openly, with textual grounds, matching the precedent
 * `scheduleStaleMediaUploadDeletion` set for its own undrawn edge:
 *
 * - `generated`/`eligible` -> `expired`: a never-presented candidate whose
 *   validity window passes must be closable, or it lingers live forever —
 *   section 17 measures "Recommendation freshness" and section 14 keeps
 *   "Existing recommendations ... accessible", neither of which a
 *   permanently stale live candidate serves. Only a system sweep
 *   (P7-ASYNC-01) reaches this edge; no user action does.
 * - `generated`/`eligible` -> `superseded`: regeneration replaces a stale
 *   candidate with a fresh one whether or not the old one was ever shown —
 *   section 6's own "A superseding recommendation references the prior
 *   record" places no presented-first condition on the prior record, and
 *   section 17 measures "duplication", which pre-presentation supersession
 *   is exactly the mechanism against.
 *
 * `postponed` is terminal HERE, deliberately: the diagram draws no edge
 * out of it, and re-surfacing a postponed recommendation (whenever product
 * policy defines it) is a NEW candidate that supersedes the postponed one
 * — preserving the original's evidence and feedback trail unmodified — not
 * an undocumented back-edge invented this stage.
 *
 * User-driven transitions (`complete`/`postpone`/`reject`) pair with an
 * append-only `recommendation_feedback` row carrying actor and timestamp;
 * composing the two is P7-BE-01's command wiring
 * (`recommendation-feedback.ts` has the row's own constructor), so these
 * functions stay pure state edges.
 *
 * Source: migrations/1785600000000_recommendations-baseline.sql;
 * architecture/recommendations-and-ai.md, section "6. Candidate
 * Lifecycle".
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { RecommendationCandidate } from './recommendation-candidate.js';

export type RecommendationCandidateState =
  | 'generated'
  | 'eligible'
  | 'presented'
  | 'completed'
  | 'postponed'
  | 'rejected'
  | 'expired'
  | 'superseded';

/** The three non-terminal states — every other state is terminal, with no outgoing edge anywhere in this file. */
export const LIVE_RECOMMENDATION_CANDIDATE_STATES: readonly RecommendationCandidateState[] = [
  'generated',
  'eligible',
  'presented',
];

function requireState(
  candidate: RecommendationCandidate,
  expected: readonly RecommendationCandidateState[],
  action: string,
): void {
  if (!expected.includes(candidate.state)) {
    throw new DomainRuleViolatedError(
      'tasks_recommendations.recommendation_candidate.state_conflict',
      `${action} requires candidate '${candidate.id}' to be in state ${expected
        .map((state) => `'${state}'`)
        .join(' or ')}, but it is '${candidate.state}'.`,
    );
  }
}

/** `generated` -> `eligible`: the candidate passed section 3's eligibility and safety filters. Deciding whether it passes is the rule engine's job (P7-RULE-01); this function only records an already-decided outcome, the same split `markMediaAvailable` documents for its own verifier. */
export function markRecommendationCandidateEligible(
  candidate: RecommendationCandidate,
  now: Date,
): RecommendationCandidate {
  requireState(candidate, ['generated'], 'markRecommendationCandidateEligible');

  return { ...candidate, state: 'eligible', revision: candidate.revision + 1, updatedAt: now };
}

/** `eligible` -> `presented`. Records `presentedAt` exactly once — the migration's `recommendation_candidate_presentation_timestamp_check` pins the same fact. Presentation never touches the evidence rows: "Presentation does not overwrite generation evidence" (section 6). */
export function presentRecommendationCandidate(
  candidate: RecommendationCandidate,
  now: Date,
): RecommendationCandidate {
  requireState(candidate, ['eligible'], 'presentRecommendationCandidate');

  return {
    ...candidate,
    state: 'presented',
    presentedAt: now,
    revision: candidate.revision + 1,
    updatedAt: now,
  };
}

/** `presented` -> `completed`. Terminal. */
export function completeRecommendationCandidate(
  candidate: RecommendationCandidate,
  now: Date,
): RecommendationCandidate {
  requireState(candidate, ['presented'], 'completeRecommendationCandidate');

  return { ...candidate, state: 'completed', revision: candidate.revision + 1, updatedAt: now };
}

/** `presented` -> `postponed`. Terminal here — see this file's own header comment for why re-surfacing is a superseding new candidate, not a back-edge. */
export function postponeRecommendationCandidate(
  candidate: RecommendationCandidate,
  now: Date,
): RecommendationCandidate {
  requireState(candidate, ['presented'], 'postponeRecommendationCandidate');

  return { ...candidate, state: 'postponed', revision: candidate.revision + 1, updatedAt: now };
}

/** `presented` -> `rejected`. Terminal. The state vocabulary is section 6's (`rejected`); the user-facing feedback verb is FR-24's (`dismissed`) — `recommendation-feedback.ts` documents the pairing. */
export function rejectRecommendationCandidate(
  candidate: RecommendationCandidate,
  now: Date,
): RecommendationCandidate {
  requireState(candidate, ['presented'], 'rejectRecommendationCandidate');

  return { ...candidate, state: 'rejected', revision: candidate.revision + 1, updatedAt: now };
}

/** Any live state -> `expired`. Terminal. The pre-presentation sources are this file's first deliberately-added edge — see the header comment. `presentedAt` is left exactly as it was: an expiry after presentation keeps its presentation fact, one before it keeps `null`, which is why the migration's timestamp CHECK admits both for this state. */
export function expireRecommendationCandidate(
  candidate: RecommendationCandidate,
  now: Date,
): RecommendationCandidate {
  requireState(candidate, LIVE_RECOMMENDATION_CANDIDATE_STATES, 'expireRecommendationCandidate');

  return { ...candidate, state: 'expired', revision: candidate.revision + 1, updatedAt: now };
}

/** Any live state -> `superseded`. Terminal. Applied to the PRIOR record; the superseding NEW candidate carries the backward `supersedesCandidateId` reference from its own creation (`createRecommendationCandidate`). The pre-presentation sources are this file's second deliberately-added edge — see the header comment. */
export function supersedeRecommendationCandidate(
  candidate: RecommendationCandidate,
  now: Date,
): RecommendationCandidate {
  requireState(candidate, LIVE_RECOMMENDATION_CANDIDATE_STATES, 'supersedeRecommendationCandidate');

  return { ...candidate, state: 'superseded', revision: candidate.revision + 1, updatedAt: now };
}
