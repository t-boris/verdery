import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  TaxonomyNameMatch,
  TaxonomyReferenceRepository,
  TaxonomySearchResult,
} from '../application/taxonomy-reference-repository.js';
import type { TaxonomyNameKind } from '../domain/taxonomy-name.js';
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
  family: string | null;
  genus: string | null;
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
    family: row.family,
    genus: row.genus,
    source: row.source as TaxonomySource,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
  };
}

export class KyselyTaxonomyReferenceRepository implements TaxonomyReferenceRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(id: Uuid): Promise<TaxonomyReference | null> {
    const row = await this.db
      .selectFrom('plants_inventory.taxonomy_reference')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toTaxonomyReference(row);
  }

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

  async searchAcrossNames(query: string | null, limit: number): Promise<TaxonomySearchResult[]> {
    if (query === null) {
      const rows = await this.db
        .selectFrom('plants_inventory.taxonomy_reference')
        .selectAll()
        .orderBy('scientific_name', 'asc')
        .limit(limit)
        .execute();

      return rows.map((row) => ({ reference: toTaxonomyReference(row), matchedName: null }));
    }

    // Every candidate name form, in one UNION ALL: the reference's own two
    // legacy fields (kinds `accepted_scientific`/`common`, matching
    // `search()`'s own two-field match above) plus every `taxonomy_name`
    // row (synonyms, cultivars, localized common names). `best_match` then
    // ranks all of a taxon's own candidates by score and keeps only its
    // single best (`rn = 1`) — one row per taxon, never a duplicate per
    // matching name.
    const result = await sql<
      TaxonomyReferenceRowLike & {
        matched_name_kind: string;
        matched_name_text: string;
        matched_locale: string | null;
        score: number;
      }
    >`
      WITH name_candidates AS (
        SELECT
          id AS taxonomy_reference_id,
          'accepted_scientific' AS name_kind,
          scientific_name AS name_text,
          NULL::text AS locale,
          similarity(scientific_name, ${query}) AS score
        FROM plants_inventory.taxonomy_reference

        UNION ALL

        SELECT
          id AS taxonomy_reference_id,
          'common' AS name_kind,
          common_name AS name_text,
          NULL::text AS locale,
          similarity(common_name, ${query}) AS score
        FROM plants_inventory.taxonomy_reference
        WHERE common_name IS NOT NULL

        UNION ALL

        SELECT
          taxonomy_reference_id,
          name_kind,
          name_text,
          locale,
          similarity(name_text, ${query}) AS score
        FROM plants_inventory.taxonomy_name
      ),
      ranked AS (
        SELECT
          taxonomy_reference_id,
          name_kind,
          name_text,
          locale,
          score,
          ROW_NUMBER() OVER (PARTITION BY taxonomy_reference_id ORDER BY score DESC, name_text ASC) AS rn
        FROM name_candidates
        WHERE score > ${SIMILARITY_THRESHOLD}
      ),
      best_match AS (
        SELECT taxonomy_reference_id, name_kind, name_text, locale, score
        FROM ranked
        WHERE rn = 1
      )
      SELECT
        reference.id AS id,
        reference.scientific_name AS scientific_name,
        reference.common_name AS common_name,
        reference.variety_name AS variety_name,
        reference.family AS family,
        reference.genus AS genus,
        reference.source AS source,
        reference.created_by_profile_id AS created_by_profile_id,
        reference.created_at AS created_at,
        best_match.name_kind AS matched_name_kind,
        best_match.name_text AS matched_name_text,
        best_match.locale AS matched_locale,
        best_match.score AS score
      FROM best_match
      JOIN plants_inventory.taxonomy_reference AS reference
        ON reference.id = best_match.taxonomy_reference_id
      ORDER BY best_match.score DESC, reference.scientific_name ASC
      LIMIT ${limit}
    `.execute(this.db);

    return result.rows.map((row) => ({
      reference: toTaxonomyReference(row),
      matchedName: {
        nameKind: row.matched_name_kind as TaxonomyNameKind,
        nameText: row.matched_name_text,
        locale: row.matched_locale,
      } satisfies TaxonomyNameMatch,
    }));
  }
}
