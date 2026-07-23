import type { TaxonomyReference } from '../domain/taxonomy-reference.js';

export interface TaxonomyReferenceRepository {
  /**
   * `query === null` lists the catalog (most recent first); a non-null query
   * matches `scientificName`, `commonName`, or `varietyName` case-insensitively.
   * The only read path this table has this pass — see this module's
   * `public.ts` doc comment for why `CreateTaxonomyReference` was scoped out.
   */
  search(query: string | null, limit: number): Promise<TaxonomyReference[]>;
}
