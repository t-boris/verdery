import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { TaxonomyReferenceRepository } from '../application/taxonomy-reference-repository.js';
import type { TaxonomyReference, TaxonomySource } from '../domain/taxonomy-reference.js';

/**
 * `pg_trgm` similarity threshold for a real (non-null) query, shared by
 * `scientificName` and `commonName`.
 *
 * `pg_trgm`'s own GUC default (`pg_trgm.similarity_threshold`) is 0.3.
 * 0.25 was chosen after checking concrete examples against a real Postgres
 * instance rather than trusting either default blind: an exact match scores
 * 1.0, a single-letter misspelling of a short name (`'tomatoe'` vs
 * `'tomato'`) scores ~0.67, a name embedded in a longer phrase
 * (`'lycopersicum'` vs `'Ocimum basilicum lycopersicum'`) scores ~0.76, while
 * two genuinely unrelated short names score 0 and two related-but-different
 * names sharing only a few letters land around 0.06–0.28. 0.25 sits below
 * every genuine match observed and above the unrelated-name noise floor;
 * 0.3 would have rejected some real misspellings this feature exists to
 * catch. See `search-plants.ts`'s own identical constant and note for
 * `displayName`, and `kysely-garden-repository.ts`'s for `garden.name`.
 */
const SIMILARITY_THRESHOLD = 0.25;

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
    if (query === null) {
      const rows = await this.db
        .selectFrom('plants_inventory.taxonomy_reference')
        .selectAll()
        .orderBy('scientific_name', 'asc')
        .limit(limit)
        .execute();

      return rows.map(toTaxonomyReference);
    }

    // `similarity(common_name, $1)` is `NULL`, not `false`, for a
    // system-catalog row with no common name — correctly excluded by `> `
    // without a special case, and `GREATEST` below correctly ignores it
    // rather than propagating `NULL` (Postgres: `GREATEST`/`LEAST` return
    // `NULL` only when *every* argument is `NULL`).
    const rows = await this.db
      .selectFrom('plants_inventory.taxonomy_reference')
      .selectAll()
      .where(
        sql<boolean>`(similarity(scientific_name, ${query}) > ${SIMILARITY_THRESHOLD}
          OR similarity(common_name, ${query}) > ${SIMILARITY_THRESHOLD})`,
      )
      .orderBy(
        sql`GREATEST(similarity(scientific_name, ${query}), similarity(common_name, ${query}))`,
        'desc',
      )
      .orderBy('scientific_name', 'asc')
      .limit(limit)
      .execute();

    return rows.map(toTaxonomyReference);
  }
}
