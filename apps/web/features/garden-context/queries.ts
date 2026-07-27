'use client';

import type {
  Garden,
  GardenContextFact,
  GardenContextFactListResult,
  GardenContextKind,
  RecordGardenContextFactRequest,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createGardenContextGateway,
  createGardenGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the Context quality section (P9D-UX-01):
 * `GET`/`PUT /gardens/{gardenId}/context[/{contextKind}]`.
 *
 * `useCallerRole` deliberately duplicates `features/gardens/queries.ts`'s
 * own hook of the same name under the identical `['gardens', gardenId]`
 * query key, rather than importing `features/gardens` — "Features import
 * public Core and Shared interfaces only" (architecture/
 * web-application-design.md, section "20. Dependency Rules"). This is not a
 * second network request in practice; TanStack Query's cache is keyed by
 * this array regardless of which file calls `useQuery` with it. Mirrors
 * `features/collaboration/queries.ts`'s own `useCallerRole`, which
 * documents the identical duplication for the identical reason.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const contextFactsQueryKey = (gardenId: string) => ['gardens', gardenId, 'context'] as const;
const gardenQueryKey = (gardenId: string) => ['gardens', gardenId] as const;

function useGardenContextGateway() {
  return useMemo(() => createGardenContextGateway(createBrowserApiClient()), []);
}

function useGardenGateway() {
  return useMemo(() => createGardenGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

/** The caller's own role on this garden — see this module's own header for why this is a second, independent read of `Garden` rather than an import of `features/gardens`. */
export function useCallerRole(gardenId: string) {
  const gateway = useGardenGateway();

  return useQuery<Garden, ApiFailureError>({
    queryKey: gardenQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(gardenId, signal)),
  });
}

export function useGardenContextFacts(gardenId: string) {
  const gateway = useGardenContextGateway();

  return useQuery<GardenContextFactListResult, ApiFailureError>({
    queryKey: contextFactsQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.list(gardenId, signal)),
  });
}

export interface RecordGardenContextFactVariables {
  readonly contextKind: GardenContextKind;
  readonly input: RecordGardenContextFactRequest;
}

export function useRecordGardenContextFact(gardenId: string) {
  const gateway = useGardenContextGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenContextFact, ApiFailureError, RecordGardenContextFactVariables>({
    mutationFn: async ({ contextKind, input }) =>
      unwrap(await gateway.record(gardenId, contextKind, input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contextFactsQueryKey(gardenId) });
    },
  });
}
