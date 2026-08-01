'use client';

import type { TaxonomyReferenceListResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createPlantGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * The candidates feature's OWN read of the taxonomy catalog, for
 * `taxonomy-reference-field.tsx`'s search-select.
 *
 * Built directly on `core/api`'s `createPlantGateway` rather than importing
 * `features/plants` — "Features import public Core and Shared interfaces
 * only" (architecture/web-application-design.md, section "20. Dependency
 * Rules"), so one feature never imports another. Mirrors
 * `features/plants/map-object-queries.ts`'s own identical "rebuild a thin
 * query directly on `core/api`" precedent, and duplicates
 * `features/plants/queries.ts`'s `useTaxonomyReferenceSearch` verbatim —
 * `searchTaxonomyReferences` is a plain garden-scoped catalog read, not a
 * candidate-specific one.
 */

function usePlantGateway() {
  return useMemo(() => createPlantGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useTaxonomyReferenceSearch(gardenId: string, query: string) {
  const gateway = usePlantGateway();
  const trimmed = query.trim();

  return useQuery<TaxonomyReferenceListResult, ApiFailureError>({
    queryKey: ['candidates', gardenId, 'taxonomy-references', trimmed] as const,
    queryFn: async ({ signal }) =>
      unwrap(
        await gateway.searchTaxonomyReferences(
          gardenId,
          trimmed === '' ? null : trimmed,
          null,
          signal,
        ),
      ),
  });
}
