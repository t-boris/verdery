/**
 * Kysely adapter for `BedOccupancyHistoryReader` — see the port's own header
 * for the reconstruction logic this SQL implements exactly.
 *
 * Raw SQL, not the query builder: two window functions (`LEAD`) and a
 * correlated subquery are genuinely clearer written directly, the same
 * judgment `backend-modular-monolith.md` section 17 reserves explicit SQL
 * for ("queries that are clearer in SQL").
 */

import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  BedOccupancyHistoryReader,
  BedOccupancyPeriod,
} from '../application/bed-occupancy-history.js';

interface BedOccupancyRow {
  plant_id: string;
  occupied_from: Date;
  occupied_until: Date | null;
  taxonomy_reference_id: string | null;
}

export class KyselyBedOccupancyHistoryReader implements BedOccupancyHistoryReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findForBed(
    bedMapObjectId: Uuid,
    intervalStart: Date,
    intervalEnd: Date,
  ): Promise<readonly BedOccupancyPeriod[]> {
    const result = await sql<BedOccupancyRow>`
      WITH placement_events AS (
        SELECT
          plant_id,
          revision,
          garden_area_map_object_id,
          recorded_at,
          LEAD(revision) OVER (PARTITION BY plant_id ORDER BY revision) AS next_revision,
          LEAD(recorded_at) OVER (PARTITION BY plant_id ORDER BY revision) AS next_recorded_at
        FROM plants_inventory.plant_revision
        WHERE garden_area_map_object_id IS NOT NULL OR placement_map_object_id IS NOT NULL
      ),
      bed_segments AS (
        SELECT
          plant_id,
          recorded_at AS occupied_from,
          next_revision,
          next_recorded_at AS occupied_until
        FROM placement_events
        WHERE garden_area_map_object_id = ${bedMapObjectId}
      )
      SELECT
        bed_segments.plant_id AS plant_id,
        bed_segments.occupied_from AS occupied_from,
        bed_segments.occupied_until AS occupied_until,
        (
          SELECT taxon_events.taxonomy_reference_id
          FROM plants_inventory.plant_revision AS taxon_events
          WHERE taxon_events.plant_id = bed_segments.plant_id
            AND taxon_events.taxonomy_reference_id IS NOT NULL
            AND (
              bed_segments.next_revision IS NULL
              OR taxon_events.revision < bed_segments.next_revision
            )
          ORDER BY taxon_events.revision DESC
          LIMIT 1
        ) AS taxonomy_reference_id
      FROM bed_segments
      WHERE bed_segments.occupied_from <= ${intervalEnd}
        AND (bed_segments.occupied_until IS NULL OR bed_segments.occupied_until >= ${intervalStart})
      ORDER BY bed_segments.occupied_from ASC
    `.execute(this.db);

    return result.rows.map((row) => ({
      plantId: row.plant_id,
      taxonomyReferenceId: row.taxonomy_reference_id,
      occupiedFrom: row.occupied_from,
      occupiedUntil: row.occupied_until,
    }));
  }
}
