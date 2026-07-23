import type { TaxonomyReference } from '../domain/taxonomy-reference.js';

export interface TaxonomyReferenceRepository {
  /**
   * `query === null` lists the catalog (most recent first, by `scientificName`
   * ascending). A non-null query matches `scientificName` or `commonName` by
   * `pg_trgm` trigram similarity — misspelling- and word-order-tolerant,
   * unlike the plain `ILIKE '%query%'` substring match this replaced in
   * P4-SEARCH-01 — ranked most-similar first. `varietyName` is deliberately
   * not part of the matching algorithm (no index backs it either — see
   * `migrations/1784950000000_search-indexes.sql`): the field is sparse and
   * narrower than `commonName`/`scientificName`, and adding it did not
   * change any real query in practice while adding a third field to every
   * ranking comparison.
   *
   * The only read path this table has this pass — see this module's
   * `public.ts` doc comment for why `CreateTaxonomyReference` was scoped out.
   */
  search(query: string | null, limit: number): Promise<TaxonomyReference[]>;
}
