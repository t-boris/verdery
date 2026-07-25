/**
 * Fetches the candidate a recommendation-scoped command targets, conceals
 * a garden mismatch, and authorizes the caller — the exact two-step shape
 * `require-task-and-authorize.ts` establishes, with one addition: the
 * recommendation routes nest under `/gardens/{gardenId}/...`, so the row's
 * own `gardenId` must match the path's before authorization even runs — a
 * candidate reached through the wrong garden's path is concealed as
 * not-found, never disclosed as forbidden (api-design.md, section 22).
 *
 * Runs against the pooled connection, before the transaction — a caller
 * lacking the capability never opens one.
 */

import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  RecommendationCandidateRepository,
  StoredCandidateWithRule,
} from './recommendation-candidate-repository.js';
import { recommendationNotFoundError } from './recommendation-errors.js';

export async function requireRecommendationAndAuthorize(
  candidates: RecommendationCandidateRepository,
  authorization: GardenAuthorization,
  gardenId: Uuid,
  recommendationId: Uuid,
  profileId: Uuid,
): Promise<StoredCandidateWithRule> {
  const [stored] = await candidates.findWithRuleByIds([recommendationId]);
  if (stored === undefined || stored.candidate.gardenId !== gardenId) {
    throw recommendationNotFoundError();
  }

  await authorization.requireCapability(gardenId, profileId, 'editGardenContent');

  return stored;
}
