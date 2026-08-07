/**
 * Kysely adapter for `SeasonalProposalCandidateSource`.
 *
 * SELECTS ONLY TAXA A GARDEN ACTUALLY GROWS, and only for the hemisphere
 * that garden is in. Drafting timing for the whole catalogue would spend
 * budget and reviewer attention on plants nobody has, and would produce a
 * queue whose length is a property of the catalogue rather than of anyone's
 * need. Demand is the ordering principle: the taxa proposed for are the
 * ones a rule is currently silent about for a real garden.
 *
 * A taxon already carrying a fact for that hemisphere is excluded whatever
 * its review status — a pending proposal is not re-proposed, and an
 * approved row is never disturbed.
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  SeasonalProposalCandidate,
  SeasonalProposalCandidateSource,
} from '../application/propose-seasonal-timing.js';

export class KyselySeasonalProposalCandidateSource implements SeasonalProposalCandidateSource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listCandidates(limit: number): Promise<readonly SeasonalProposalCandidate[]> {
    const rows = await sql<{
      taxonomy_reference_id: string;
      scientific_name: string;
      common_name: string | null;
      family: string | null;
      hemisphere: 'northern' | 'southern';
    }>`
      SELECT DISTINCT
        reference.id AS taxonomy_reference_id,
        reference.scientific_name,
        reference.common_name,
        reference.family,
        -- The hemisphere the garden growing this taxon is in, derived from
        -- its own georeference. The anchor is a WGS84 point; a garden
        -- without one contributes no candidate at all, because timing
        -- cannot be drafted for a hemisphere nobody knows.
        CASE WHEN ST_Y(georeference.geographic_anchor) >= 0
             THEN 'northern' ELSE 'southern' END AS hemisphere
      FROM plants_inventory.plant AS plant
      JOIN plants_inventory.taxonomy_reference AS reference
        ON reference.id = plant.taxonomy_reference_id
      JOIN gardens_mapping.garden AS garden
        ON garden.id = plant.garden_id
      JOIN gardens_mapping.georeference AS georeference
        ON georeference.garden_id = garden.id
      WHERE plant.status = 'active'
        AND garden.lifecycle_state = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM plants_inventory.taxonomy_seasonal_fact AS fact
          WHERE fact.taxonomy_reference_id = reference.id
            AND fact.hemisphere = (
              CASE WHEN ST_Y(georeference.geographic_anchor) >= 0
                   THEN 'northern' ELSE 'southern' END
            )
        )
      ORDER BY reference.scientific_name ASC
      LIMIT ${limit}
    `.execute(this.db);

    return rows.rows.map((row) => ({
      taxonomyReferenceId: row.taxonomy_reference_id,
      scientificName: row.scientific_name,
      commonName: row.common_name,
      family: row.family,
      hemisphere: row.hemisphere,
    }));
  }
}
