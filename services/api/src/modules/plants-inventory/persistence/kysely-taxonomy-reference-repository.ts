import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { TaxonomyReferenceRepository } from '../application/taxonomy-reference-repository.js';
import type { TaxonomyReference, TaxonomySource } from '../domain/taxonomy-reference.js';

interface TaxonomyReferenceRowLike {
  id: string;
  scientific_name: string;
  common_name: string | null;
  variety_name: string | null;
  source: string;
  created_by_profile_id: string | null;
  created_at: Date;
}

function toTaxonomyReference(row: TaxonomyReferenceRowLike): TaxonomyReference {
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

export class KyselyTaxonomyReferenceRepository implements TaxonomyReferenceRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async search(query: string | null, limit: number): Promise<TaxonomyReference[]> {
    let builder = this.db
      .selectFrom('plants_inventory.taxonomy_reference')
      .selectAll()
      .orderBy('scientific_name', 'asc')
      .limit(limit);

    if (query !== null) {
      const pattern = `%${query}%`;
      builder = builder.where((eb) =>
        eb.or([
          eb('scientific_name', 'ilike', pattern),
          eb('common_name', 'ilike', pattern),
          eb('variety_name', 'ilike', pattern),
        ]),
      );
    }

    const rows = await builder.execute();
    return rows.map(toTaxonomyReference);
  }
}
