/**
 * Kysely adapter for `EvaluationGardenSource` — see the port's own header
 * comment for the eligibility definition, the due-check semantics, and the
 * paging contract.
 */

import { sql, type Kysely } from 'kysely';
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

  /**
   * Written as one statement with a lateral watermark join rather than a
   * per-garden round trip: the sweep asks this question on every tick, and
   * the answer is usually "none", so the cheap shape is the one that runs
   * constantly.
   *
   * `COALESCE(last_evaluated_at, 'epoch')` makes a never-evaluated garden
   * unconditionally due without a separate branch — every "changed since"
   * comparison is then true against a timestamp before any data existed.
   *
   * The change probes are `EXISTS` rather than aggregates on purpose: the
   * question is "is there anything newer", and an existence check can stop
   * at the first row instead of scanning a garden's whole history.
   */
  async listGardenIdsDueForEvaluation(
    afterGardenId: Uuid | null,
    limit: number,
    stalenessFloor: Date,
  ): Promise<readonly Uuid[]> {
    const after = afterGardenId === null ? sql`NULL::uuid` : sql`${afterGardenId}::uuid`;

    const rows = await sql<{ id: Uuid }>`
      SELECT garden.id
      FROM gardens_mapping.garden AS garden
      LEFT JOIN tasks_recommendations.garden_evaluation_state AS state
        ON state.garden_id = garden.id
      WHERE garden.lifecycle_state = 'active'
        AND EXISTS (
          SELECT 1 FROM plants_inventory.plant AS plant
          WHERE plant.garden_id = garden.id AND plant.status = 'active'
        )
        AND (${after} IS NULL OR garden.id > ${after})
        AND (
          COALESCE(state.last_evaluated_at, 'epoch'::timestamptz) <= ${stalenessFloor}
          OR EXISTS (
            SELECT 1 FROM plants_inventory.plant AS changed
            WHERE changed.garden_id = garden.id
              AND changed.updated_at > COALESCE(state.last_evaluated_at, 'epoch'::timestamptz)
          )
          OR EXISTS (
            SELECT 1 FROM observations_history.observation AS observation
            WHERE observation.garden_id = garden.id
              AND observation.recorded_at > COALESCE(state.last_evaluated_at, 'epoch'::timestamptz)
          )
          OR EXISTS (
            SELECT 1 FROM tasks_recommendations.task AS task
            WHERE task.garden_id = garden.id
              AND task.updated_at > COALESCE(state.last_evaluated_at, 'epoch'::timestamptz)
          )
          OR EXISTS (
            SELECT 1 FROM integrations.weather_record AS weather
            WHERE weather.garden_id = garden.id
              AND weather.fetched_at > COALESCE(state.last_evaluated_at, 'epoch'::timestamptz)
          )
        )
      ORDER BY garden.id ASC
      LIMIT ${limit}
    `.execute(this.db);

    return rows.rows.map((row) => row.id);
  }
}
