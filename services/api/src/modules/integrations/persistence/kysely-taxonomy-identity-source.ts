/**
 * Kysely adapter for `TaxonomyIdentitySource` — a SELECT-only, cross-schema
 * read of `plants_inventory.taxonomy_reference`, the narrow-read-port
 * precedent (`KyselyEvaluationGardenSource`). See the port's own header for
 * why this module owns the read shape; nothing here can write another
 * module's data.
 *
 * Source: migrations/1784900000000_plants-observations-tasks-baseline.sql,
 * `plants_inventory.taxonomy_reference`.
 */

import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { TaxonomyReference, TaxonomySource } from '../../plants-inventory/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { TaxonomyIdentitySource } from '../application/taxonomy-identity-source.js';

export class KyselyTaxonomyIdentitySource implements TaxonomyIdentitySource {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(taxonomyReferenceId: Uuid): Promise<TaxonomyReference | null> {
    const row = await this.db
      .selectFrom('plants_inventory.taxonomy_reference')
      .selectAll()
      .where('id', '=', taxonomyReferenceId)
      .executeTakeFirst();

    if (row === undefined) {
      return null;
    }
    return {
      id: row.id,
      scientificName: row.scientific_name,
      commonName: row.common_name,
      varietyName: row.variety_name,
      source: row.source as TaxonomySource,
      createdByProfileId: row.created_by_profile_id,
      createdAt: row.created_at,
    };
  }
}
