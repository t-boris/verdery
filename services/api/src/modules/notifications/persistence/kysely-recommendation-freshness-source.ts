/**
 * SELECT-only cross-schema implementation of
 * `RecommendationFreshnessSource` (P7-NOTIF-01): the candidate's current
 * lifecycle facts from `tasks_recommendations.recommendation_candidate` —
 * the narrow-read-port precedent again. A missing row maps to `null` (the
 * policy's `candidate_missing` suppression), never an error.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateFreshnessFacts } from '../domain/notification-policy.js';
import type { RecommendationFreshnessSource } from '../application/recommendation-freshness-source.js';

export class KyselyRecommendationFreshnessSource implements RecommendationFreshnessSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findCandidate(candidateId: Uuid): Promise<CandidateFreshnessFacts | null> {
    const row = await this.db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .select(['id', 'garden_id', 'state', 'window_end'])
      .where('id', '=', candidateId)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      gardenId: row.garden_id,
      state: row.state,
      windowEnd: row.window_end,
    };
  }
}
