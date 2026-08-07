'use client';

import type { GardenWeatherResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createWeatherGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hook for the garden weather read.
 *
 * One query, no mutations: nothing a client does can refresh weather, so
 * there is no invalidation graph to maintain here. The server sweep owns
 * fetching and this hook only reads what it stored.
 *
 * `staleTime` is deliberately generous. The underlying records change at
 * most once an hour (the observation freshness window IS the cache window
 * server-side), so refetching on every window focus would spend requests
 * to re-render identical numbers.
 *
 * Source: architecture/web-application-design.md, section "8. API Access";
 * packages/api-contracts/openapi.yaml, tag `Weather`.
 */

const weatherQueryKey = (gardenId: string) => ['weather', gardenId] as const;

/** Matches the server's own observation freshness window — see `WEATHER_OBSERVATION_FRESH_FOR_MS`. */
const WEATHER_STALE_TIME_MS = 60 * 60 * 1000;

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useGardenWeather(gardenId: string) {
  const gateway = useMemo(() => createWeatherGateway(createBrowserApiClient()), []);

  return useQuery<GardenWeatherResult, ApiFailureError>({
    queryKey: weatherQueryKey(gardenId),
    queryFn: ({ signal }) => gateway.getGardenWeather(gardenId, signal).then(unwrap),
    staleTime: WEATHER_STALE_TIME_MS,
  });
}
