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
const TAXON_PROFILE_STALE_TIME_MS = 24 * 60 * 60 * 1000;
const TAXON_PROFILE_CACHE_TIME_MS = 7 * TAXON_PROFILE_STALE_TIME_MS;

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
    // Photo identification can create a canonical taxonomy reference while
    // another route has this browse result cached. Re-entering the catalog
    // always reconciles with server truth instead of presenting that old
    // result as the current catalog.
    refetchOnMount: 'always',
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
    staleTime: TAXON_PROFILE_STALE_TIME_MS,
    gcTime: TAXON_PROFILE_CACHE_TIME_MS,
    refetchOnWindowFocus: false,
  });
}
