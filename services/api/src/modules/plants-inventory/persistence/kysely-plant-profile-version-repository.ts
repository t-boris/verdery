/**
 * Kysely implementation of `PlantProfileVersionRepository` over
 * `plants_inventory.plant_profile_version`. Append-only: `insert` is the
 * table's only write, matching `KyselyPlantContentRecordRepository`'s
 * identical posture for its own append-only table.
 *
 * Source: migrations/1787700000000_plant-taxon-knowledge-profile.sql.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PlantProfileVersionRepository } from '../application/plant-profile-version-repository.js';
import type { PlantProfileVersion, ResolvedFact } from '../domain/plant-profile-version.js';
import type { PlantProfileVersionRow } from './schema.js';

function toPlantProfileVersion(row: Selectable<PlantProfileVersionRow>): PlantProfileVersion {
  return {
    id: row.id,
    taxonomyReferenceId: row.taxonomy_reference_id,
    resolvedFacts: row.resolved as readonly ResolvedFact[],
    isPartial: row.is_partial,
    createdAt: row.created_at,
  };
}

export class KyselyPlantProfileVersionRepository implements PlantProfileVersionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(version: PlantProfileVersion): Promise<void> {
    await this.db
      .insertInto('plants_inventory.plant_profile_version')
      .values({
        id: version.id,
        taxonomy_reference_id: version.taxonomyReferenceId,
        resolved: JSON.stringify(version.resolvedFacts),
        is_partial: version.isPartial,
        created_at: version.createdAt,
      })
      .execute();
  }

  async findLatest(taxonomyReferenceId: Uuid): Promise<PlantProfileVersion | null> {
    const row = await this.db
      .selectFrom('plants_inventory.plant_profile_version')
      .selectAll()
      .where('taxonomy_reference_id', '=', taxonomyReferenceId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    return row === undefined ? null : toPlantProfileVersion(row);
  }
}
