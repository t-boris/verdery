/**
 * Kysely implementation of `PlantTaxonomyMappingRepository` over
 * `integrations.plant_taxonomy_mapping`.
 *
 * `insert` targets the partial unique index
 * `plant_taxonomy_mapping_live_identity_idx` with `ON CONFLICT ... DO
 * NOTHING`, so a concurrent mapper's win surfaces as a clean `false`
 * instead of a raced constraint error. `updateVerificationState` is the one
 * mutation and is guarded by the expected current state — identity columns
 * have no write path at all, which is what keeps re-identification an
 * explicit pair of rows.
 *
 * Source: migrations/1785900000000_integrations-plant-content-baseline.sql.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PlantTaxonomyMapping,
  TaxonomyMappingVerificationState,
} from '../domain/plant-taxonomy-mapping.js';
import type { PlantTaxonomyMappingRepository } from '../application/plant-taxonomy-mapping-repository.js';
import type { PlantTaxonomyMappingRow } from './schema.js';

function toMapping(row: Selectable<PlantTaxonomyMappingRow>): PlantTaxonomyMapping {
  return {
    id: row.id,
    taxonomyReferenceId: row.taxonomy_reference_id,
    providerKey: row.provider_key,
    providerTaxonId: row.provider_taxon_id,
    providerScientificName: row.provider_scientific_name,
    confidence: row.confidence,
    verificationState: row.verification_state as TaxonomyMappingVerificationState,
    stateNote: row.state_note,
    stateChangedAt: row.state_changed_at,
    createdAt: row.created_at,
  };
}

export class KyselyPlantTaxonomyMappingRepository implements PlantTaxonomyMappingRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(mapping: PlantTaxonomyMapping): Promise<boolean> {
    const inserted = await this.db
      .insertInto('integrations.plant_taxonomy_mapping')
      .values({
        id: mapping.id,
        taxonomy_reference_id: mapping.taxonomyReferenceId,
        provider_key: mapping.providerKey,
        provider_taxon_id: mapping.providerTaxonId,
        provider_scientific_name: mapping.providerScientificName,
        confidence: mapping.confidence,
        verification_state: mapping.verificationState,
        state_note: mapping.stateNote,
        state_changed_at: mapping.stateChangedAt,
        created_at: mapping.createdAt,
      })
      .onConflict((oc) =>
        oc
          .columns(['provider_key', 'taxonomy_reference_id'])
          .where('verification_state', '<>', 'rejected')
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();

    return inserted !== undefined;
  }

  async findLive(
    providerKey: string,
    taxonomyReferenceId: Uuid,
  ): Promise<PlantTaxonomyMapping | null> {
    const row = await this.db
      .selectFrom('integrations.plant_taxonomy_mapping')
      .selectAll()
      .where('provider_key', '=', providerKey)
      .where('taxonomy_reference_id', '=', taxonomyReferenceId)
      .where('verification_state', '<>', 'rejected')
      .executeTakeFirst();

    return row === undefined ? null : toMapping(row);
  }

  async findByProviderIdentity(
    providerKey: string,
    providerTaxonId: string,
  ): Promise<readonly PlantTaxonomyMapping[]> {
    const rows = await this.db
      .selectFrom('integrations.plant_taxonomy_mapping')
      .selectAll()
      .where('provider_key', '=', providerKey)
      .where('provider_taxon_id', '=', providerTaxonId)
      .where('verification_state', '<>', 'rejected')
      .execute();

    return rows.map(toMapping);
  }

  async updateVerificationState(
    mappingId: Uuid,
    expectedCurrentState: TaxonomyMappingVerificationState,
    nextState: TaxonomyMappingVerificationState,
    stateNote: string | null,
    stateChangedAt: Date,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('integrations.plant_taxonomy_mapping')
      .set({
        verification_state: nextState,
        state_note: stateNote,
        state_changed_at: stateChangedAt,
      })
      .where('id', '=', mappingId)
      .where('verification_state', '=', expectedCurrentState)
      .executeTakeFirst();

    return result.numUpdatedRows > 0n;
  }
}
