/**
 * Narrow cross-schema read port for recommendation freshness (P7-NOTIF-01):
 * the policy must recheck the candidate's CURRENT state before creating
 * intents (the same classification the send-time recheck applies again —
 * notifications.md section 9), because a drained-late event may describe a
 * candidate that has since been acted on, superseded, or expired.
 *
 * SELECT-only over `tasks_recommendations.recommendation_candidate`, the
 * established narrow-read-port precedent. A missing row is a legitimate
 * answer (`null` -> the policy suppresses as `candidate_missing`), never an
 * error: intents deliberately hold no FK to the candidate.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateFreshnessFacts } from '../domain/notification-policy.js';

export interface RecommendationFreshnessSource {
  findCandidate(candidateId: Uuid): Promise<CandidateFreshnessFacts | null>;
}
