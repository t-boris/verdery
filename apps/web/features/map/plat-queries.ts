'use client';

import type { PlatReading } from '@verdery/api-contracts';
import { useMutation } from '@tanstack/react-query';

import {
  ApiFailureError,
  createBrowserApiClient,
  createMapGateway,
  isFailure,
} from '@/core/api/public';

/**
 * Reading an uploaded plat of survey (ADR-0018).
 *
 * A mutation rather than a query even though it writes nothing: it spends a
 * provider call, so it must run when a person asks for it and never on a
 * cache miss, a refocus, or a retry. Nothing is cached for the same reason —
 * the answer belongs to the review that follows it, not to the query layer.
 */
export function useReadPlat(gardenId: string) {
  return useMutation<PlatReading, ApiFailureError, { readonly planMediaId: string }>({
    mutationFn: async ({ planMediaId }) => {
      const gateway = createMapGateway(createBrowserApiClient());
      const result = await gateway.readPlat(gardenId, planMediaId);
      if (isFailure(result)) {
        throw new ApiFailureError(result);
      }
      return result.data;
    },
  });
}
