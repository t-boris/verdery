/**
 * The recommendations slice of one garden's export snapshot
 * (P8-EXPORT-01) — split from `kysely-garden-content-reader.ts` for the
 * 600-line file rule; same SELECT-only, same-transaction posture (the
 * caller passes the ONE repeatable-read transaction every snapshot read
 * shares). Candidates join their `rule_version` row so the package carries
 * the rule key/version pair directly, matching the doc's "recommendations
 * reflect the rule versions recorded with them".
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { PAGE_SIZE, readAllPages, toJsonRecord } from './snapshot-read-helpers.js';

export interface GardenRecommendationsData {
  recommendations: Record<string, unknown>[];
  recommendationEvidence: Record<string, unknown>[];
  recommendationPriorityFactors: Record<string, unknown>[];
  recommendationFeedback: Record<string, unknown>[];
  recommendationAiExplanations: Record<string, unknown>[];
}

export async function readGardenRecommendations(
  trx: Kysely<DatabaseSchema>,
  gardenId: Uuid,
): Promise<GardenRecommendationsData> {
  const candidates = await readAllPages((afterId) => {
    let query = trx
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .innerJoin(
        'tasks_recommendations.rule_version',
        'tasks_recommendations.rule_version.id',
        'tasks_recommendations.recommendation_candidate.rule_version_id',
      )
      .select([
        'tasks_recommendations.recommendation_candidate.id as id',
        'tasks_recommendations.recommendation_candidate.target_kind as target_kind',
        'tasks_recommendations.recommendation_candidate.target_garden_area_id as target_garden_area_id',
        'tasks_recommendations.recommendation_candidate.target_plant_id as target_plant_id',
        'tasks_recommendations.recommendation_candidate.care_category as care_category',
        'tasks_recommendations.recommendation_candidate.explanation as explanation',
        'tasks_recommendations.rule_version.rule_key as rule_key',
        'tasks_recommendations.rule_version.version as rule_version',
        'tasks_recommendations.recommendation_candidate.safety_tier as safety_tier',
        'tasks_recommendations.recommendation_candidate.state as state',
        'tasks_recommendations.recommendation_candidate.urgency as urgency',
        'tasks_recommendations.recommendation_candidate.window_start as window_start',
        'tasks_recommendations.recommendation_candidate.window_end as window_end',
        'tasks_recommendations.recommendation_candidate.supersedes_candidate_id as supersedes_candidate_id',
        'tasks_recommendations.recommendation_candidate.presented_at as presented_at',
        'tasks_recommendations.recommendation_candidate.created_at as created_at',
        'tasks_recommendations.recommendation_candidate.updated_at as updated_at',
      ])
      .where('tasks_recommendations.recommendation_candidate.garden_id', '=', gardenId)
      .orderBy('tasks_recommendations.recommendation_candidate.id')
      .limit(PAGE_SIZE);
    if (afterId !== null) {
      query = query.where('tasks_recommendations.recommendation_candidate.id', '>', afterId);
    }
    return query.execute();
  });

  const candidateIds = candidates.map((candidate) => candidate.id);
  if (candidateIds.length === 0) {
    return {
      recommendations: [],
      recommendationEvidence: [],
      recommendationPriorityFactors: [],
      recommendationFeedback: [],
      recommendationAiExplanations: [],
    };
  }

  const evidence = await trx
    .selectFrom('tasks_recommendations.recommendation_evidence')
    .selectAll()
    .where('candidate_id', 'in', candidateIds)
    .orderBy('id')
    .execute();
  const priorityFactors = await trx
    .selectFrom('tasks_recommendations.recommendation_priority_factor')
    .selectAll()
    .where('candidate_id', 'in', candidateIds)
    .orderBy('id')
    .execute();
  const feedback = await trx
    .selectFrom('tasks_recommendations.recommendation_feedback')
    .selectAll()
    .where('candidate_id', 'in', candidateIds)
    .orderBy('id')
    .execute();
  const aiExplanations = await trx
    .selectFrom('tasks_recommendations.recommendation_ai_explanation')
    .selectAll()
    .where('candidate_id', 'in', candidateIds)
    .orderBy('id')
    .execute();

  return {
    recommendations: candidates.map(toJsonRecord),
    recommendationEvidence: evidence.map(toJsonRecord),
    recommendationPriorityFactors: priorityFactors.map(toJsonRecord),
    recommendationFeedback: feedback.map(toJsonRecord),
    recommendationAiExplanations: aiExplanations.map(toJsonRecord),
  };
}
