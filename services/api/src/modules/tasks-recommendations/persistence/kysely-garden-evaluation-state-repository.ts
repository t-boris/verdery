/**
 * Kysely adapter for `GardenEvaluationStateRepository` — see the port's own
 * header for why this write shares the evaluation transaction.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenEvaluationStateRepository } from '../application/garden-evaluation-state-repository.js';

export class KyselyGardenEvaluationStateRepository implements GardenEvaluationStateRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async recordEvaluated(gardenId: Uuid, evaluatedAt: Date): Promise<void> {
    await this.db
      .insertInto('tasks_recommendations.garden_evaluation_state')
      .values({ garden_id: gardenId, last_evaluated_at: evaluatedAt })
      .onConflict((conflict) =>
        conflict.column('garden_id').doUpdateSet({ last_evaluated_at: evaluatedAt }),
      )
      .execute();
  }
}
