'use client';

import type { Garden, GardenListResult } from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createGardenGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the garden lifecycle.
 *
 * Cache keys, invalidation, and mutation status all live here — feature
 * components consume hooks, never the gateway directly.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const GARDENS_QUERY_KEY = ['gardens'] as const;
const gardenQueryKey = (gardenId: string) => ['gardens', gardenId] as const;

function useGardenGateway() {
  return useMemo(() => createGardenGateway(createBrowserApiClient()), []);
}

/** Throws the failure so TanStack Query's own error state carries it, typed, to the caller. */
function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useGardens() {
  const gateway = useGardenGateway();

  return useQuery<GardenListResult, ApiFailureError>({
    queryKey: GARDENS_QUERY_KEY,
    queryFn: async ({ signal }) => unwrap(await gateway.list(null, signal)),
  });
}

export function useGarden(gardenId: string) {
  const gateway = useGardenGateway();

  return useQuery<Garden, ApiFailureError>({
    queryKey: gardenQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(gardenId, signal)),
  });
}

export function useCreateGarden() {
  const gateway = useGardenGateway();
  const queryClient = useQueryClient();

  return useMutation<Garden, ApiFailureError, string>({
    mutationFn: async (name) => unwrap(await gateway.create(name, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: GARDENS_QUERY_KEY });
    },
  });
}

export function useRenameGarden(gardenId: string) {
  const gateway = useGardenGateway();
  const queryClient = useQueryClient();

  return useMutation<Garden, ApiFailureError, { name: string; expectedRevision: number }>({
    mutationFn: async ({ name, expectedRevision }) =>
      unwrap(await gateway.rename(gardenId, name, expectedRevision, generateIdempotencyKey())),
    onSuccess: (garden) => {
      queryClient.setQueryData(gardenQueryKey(gardenId), garden);
      void queryClient.invalidateQueries({ queryKey: GARDENS_QUERY_KEY });
    },
  });
}

export function useArchiveGarden(gardenId: string) {
  const gateway = useGardenGateway();
  const queryClient = useQueryClient();

  return useMutation<Garden, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(await gateway.archive(gardenId, expectedRevision, generateIdempotencyKey())),
    onSuccess: (garden) => {
      queryClient.setQueryData(gardenQueryKey(gardenId), garden);
      void queryClient.invalidateQueries({ queryKey: GARDENS_QUERY_KEY });
    },
  });
}

export function useRequestGardenDeletion(gardenId: string) {
  const gateway = useGardenGateway();
  const queryClient = useQueryClient();

  return useMutation<Garden, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(await gateway.requestDeletion(gardenId, expectedRevision, generateIdempotencyKey())),
    onSuccess: (garden) => {
      queryClient.setQueryData(gardenQueryKey(gardenId), garden);
      void queryClient.invalidateQueries({ queryKey: GARDENS_QUERY_KEY });
    },
  });
}
