/**
 * Kysely adapter for `CareRulePlantReadinessSource` — three existence
 * questions about one garden's plants, answered in one statement.
 *
 * EXISTENCE, NOT COUNTS: the caller asks "can this rule say anything at
 * all", and one qualifying plant is enough to answer yes. `EXISTS` can stop
 * at the first matching row, and this read runs whenever somebody opens the
 * care-rules page.
 *
 * Cross-schema read of `plants_inventory`, the same narrow-read-port shape
 * `KyselyEvaluationGardenSource` already uses for the sweep's own
 * eligibility question.
 *
 * The seasonal-fact probe applies the SAME `horticulturally_reviewed`
 * filter the rule-facing repository does. An unreviewed row is treated as
 * absent here exactly as it is there — otherwise this page would promise a
 * rule could fire on content the engine will refuse to read.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CareRulePlantReadinessSource } from '../application/get-garden-care-rules.js';

export class KyselyCareRulePlantReadinessSource implements CareRulePlantReadinessSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async readGardenPlantReadiness(
    gardenId: Uuid,
    hemisphere: 'northern' | 'southern' | null,
  ): Promise<{
    readonly hasIdentifiedPlant: boolean;
    readonly hasPlacedPlant: boolean;
    readonly hasReviewedSeasonalFact: boolean;
  }> {
    const result = await sql<{
      has_identified_plant: boolean;
      has_placed_plant: boolean;
      has_reviewed_seasonal_fact: boolean;
    }>`
      SELECT
        EXISTS (
          SELECT 1 FROM plants_inventory.plant AS plant
          WHERE plant.garden_id = ${gardenId}::uuid
            AND plant.status = 'active'
            AND plant.taxonomy_reference_id IS NOT NULL
        ) AS has_identified_plant,
        EXISTS (
          SELECT 1 FROM plants_inventory.plant AS plant
          WHERE plant.garden_id = ${gardenId}::uuid
            AND plant.status = 'active'
            AND plant.garden_area_map_object_id IS NOT NULL
        ) AS has_placed_plant,
        -- A null hemisphere cannot match any row: seasonal timing differs by
        -- hemisphere, so it is part of the natural key rather than a filter
        -- that could be dropped. The comparison against NULL yields false,
        -- which is the honest answer — not "no facts exist" but "we cannot
        -- know which ones apply".
        EXISTS (
          SELECT 1
          FROM plants_inventory.plant AS plant
          JOIN plants_inventory.taxonomy_seasonal_fact AS fact
            ON fact.taxonomy_reference_id = plant.taxonomy_reference_id
          WHERE plant.garden_id = ${gardenId}::uuid
            AND plant.status = 'active'
            AND fact.hemisphere = ${hemisphere}
            AND fact.review_status = 'horticulturally_reviewed'
        ) AS has_reviewed_seasonal_fact
    `.execute(this.db);

    const row = result.rows[0];
    return {
      hasIdentifiedPlant: row?.has_identified_plant ?? false,
      hasPlacedPlant: row?.has_placed_plant ?? false,
      hasReviewedSeasonalFact: row?.has_reviewed_seasonal_fact ?? false,
    };
  }
}
