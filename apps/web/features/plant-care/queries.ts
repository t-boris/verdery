'use client';

import type { PlantCareView } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createPlantCareGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hook for one plant's care view.
 *
 * Shorter `staleTime` than the care-rules disclosure: this changes whenever
 * the evaluation sweep runs (every few minutes) or the gardener completes
 * something, and it is the panel a person reads to decide what to do right
 * now.
 */

const plantCareQueryKey = (gardenId: string, plantId: string) =>
  ['plant-care', gardenId, plantId] as const;

const PLANT_CARE_STALE_TIME_MS = 60 * 1000;

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function usePlantCare(gardenId: string, plantId: string) {
  const gateway = useMemo(() => createPlantCareGateway(createBrowserApiClient()), []);

  return useQuery<PlantCareView, ApiFailureError>({
    queryKey: plantCareQueryKey(gardenId, plantId),
    queryFn: ({ signal }) => gateway.getPlantCare(gardenId, plantId, signal).then(unwrap),
    staleTime: PLANT_CARE_STALE_TIME_MS,
  });
}
