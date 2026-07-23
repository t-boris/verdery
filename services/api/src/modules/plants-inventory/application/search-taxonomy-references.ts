/**
 * Read path for `plants_inventory.taxonomy_reference` — what `AddPlant`'s
 * caller uses to pick a `taxonomyReferenceId`.
 *
 * No `GardenAuthorization` check: the catalog is not garden-scoped data
 * (`taxonomy_reference` carries no `garden_id`), the same way a product
 * catalog is not owned by any one customer — every authenticated caller may
 * search it, matching the read-only, no-`CreateTaxonomyReference` scope this
 * module's `public.ts` doc comment explains in full.
 */

import {
  toTaxonomyReferenceResource,
  type TaxonomyReferenceResource,
} from './taxonomy-reference-view.js';
import type { TaxonomyReferenceRepository } from './taxonomy-reference-repository.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function boundedLimit(rawLimit: number | undefined): number {
  const limit = rawLimit ?? DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

export class SearchTaxonomyReferences {
  constructor(private readonly taxonomyReferences: TaxonomyReferenceRepository) {}

  async execute(query: string | null, limit?: number): Promise<TaxonomyReferenceResource[]> {
    const trimmedQuery = query === null ? null : query.trim();
    const results = await this.taxonomyReferences.search(
      trimmedQuery === '' ? null : trimmedQuery,
      boundedLimit(limit),
    );

    return results.map(toTaxonomyReferenceResource);
  }
}
