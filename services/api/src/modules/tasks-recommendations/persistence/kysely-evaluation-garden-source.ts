/**
 * Kysely adapter for `EvaluationGardenSource` — see the port's own header
 * comment for the eligibility definition and paging semantics.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { EvaluationGardenSource } from '../application/evaluation-garden-source.js';

export class KyselyEvaluationGardenSource implements EvaluationGardenSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listEligibleGardenIds(afterGardenId: Uuid | null, limit: number): Promise<readonly Uuid[]> {
    let query = this.db
      .selectFrom('gardens_mapping.garden as garden')
      .select('garden.id')
      .where('garden.lifecycle_state', '=', 'active')
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('plants_inventory.plant as plant')
            .select('plant.id')
            .whereRef('plant.garden_id', '=', 'garden.id')
            .where('plant.status', '=', 'active'),
        ),
      )
      .orderBy('garden.id', 'asc')
      .limit(limit);

    if (afterGardenId !== null) {
      query = query.where('garden.id', '>', afterGardenId);
    }

    const rows = await query.execute();
    return rows.map((row) => row.id);
  }
}
