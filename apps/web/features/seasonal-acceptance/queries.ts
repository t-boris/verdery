'use client';

import type {
  AcceptSeasonalFactResult,
  GardenSeasonalAcceptanceQueue,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createSeasonalAcceptanceGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the seasonal-timing acceptance queue.
 *
 * Long `staleTime`, like the care-rules disclosure this sits beside: the
 * queue changes when a garden gains a plant or someone accepts an entry,
 * neither of which is worth a refetch on every window focus.
 *
 * Accepting invalidates the care rules as well as the queue. That is the
 * point of the panel: the accept is what clears
 * `careRules.blocker.seasonalTimingNotAccepted`, and leaving the disclosure
 * beside it still saying "not accepted" would contradict the row that just
 * disappeared.
 */

const acceptanceQueueQueryKey = (gardenId: string) => ['seasonal-acceptance', gardenId] as const;
const careRulesQueryKey = (gardenId: string) => ['care-rules', gardenId] as const;

const ACCEPTANCE_QUEUE_STALE_TIME_MS = 5 * 60 * 1000;

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

function useSeasonalAcceptanceGateway() {
  return useMemo(() => createSeasonalAcceptanceGateway(createBrowserApiClient()), []);
}

export function useSeasonalAcceptanceQueue(gardenId: string) {
  const gateway = useSeasonalAcceptanceGateway();

  return useQuery<GardenSeasonalAcceptanceQueue, ApiFailureError>({
    queryKey: acceptanceQueueQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.listAwaitingAcceptance(gardenId, signal)),
    staleTime: ACCEPTANCE_QUEUE_STALE_TIME_MS,
  });
}

export function useAcceptSeasonalFact(gardenId: string) {
  const gateway = useSeasonalAcceptanceGateway();
  const queryClient = useQueryClient();

  return useMutation<AcceptSeasonalFactResult, ApiFailureError, string>({
    mutationFn: async (factId) => unwrap(await gateway.accept(gardenId, factId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: acceptanceQueueQueryKey(gardenId) });
      void queryClient.invalidateQueries({ queryKey: careRulesQueryKey(gardenId) });
    },
  });
}
