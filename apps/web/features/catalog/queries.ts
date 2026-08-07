'use client';

import type { PlantTaxonProfileResult, TaxonomyReferenceListResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createPlantCatalogGateway,
  createPlantGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * The catalog's two reads: finding a taxon by name, and the materialized
 * knowledge profile assembled for one.
 *
 * The name search is `searchTaxonomyReferences`, the same operation the
 * plant-add form's taxonomy picker uses. There is no separate catalog search
 * endpoint and this feature does not pretend otherwise: browsing the catalog
 * IS searching the taxonomy references this garden can already resolve
 * against, and the query keys match `features/plants/taxonomy-queries.ts`'s
 * so both share one cache entry per query.
 *
 * Source: packages/api-contracts/openapi.yaml, operations
 * `searchTaxonomyReferences` and `getTaxonProfile`.
 */

/** How many results a browse page shows before asking the reader to narrow the name. */
export const TAXON_SEARCH_LIMIT = 25;

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useTaxonSearch(gardenId: string, query: string) {
  const gateway = useMemo(() => createPlantGateway(createBrowserApiClient()), []);
  const trimmed = query.trim();

  return useQuery<TaxonomyReferenceListResult, ApiFailureError>({
    queryKey: ['taxonomy-references', gardenId, trimmed, TAXON_SEARCH_LIMIT] as const,
    queryFn: async ({ signal }) =>
      unwrap(
        await gateway.searchTaxonomyReferences(
          gardenId,
          trimmed === '' ? null : trimmed,
          TAXON_SEARCH_LIMIT,
          signal,
        ),
      ),
  });
}

/**
 * A taxon's profile and licensed reference imagery. The fact projection may
 * be null while imagery is already available from on-demand enrichment.
 */
export function useTaxonProfile(taxonomyReferenceId: string) {
  const gateway = useMemo(() => createPlantCatalogGateway(createBrowserApiClient()), []);

  return useQuery<PlantTaxonProfileResult, ApiFailureError>({
    queryKey: ['plant-catalog', 'profile', taxonomyReferenceId] as const,
    queryFn: async ({ signal }) =>
      unwrap(await gateway.getTaxonProfile(taxonomyReferenceId, signal)),
    retry: false,
  });
}
