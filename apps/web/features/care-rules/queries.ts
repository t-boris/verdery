'use client';

import type { GardenCareRulesResult } from '@verdery/api-contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createCareRuleGateway,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hook for the care-rules disclosure.
 *
 * Long `staleTime`: the rule catalog is application content that changes
 * only on deploy, and the blockers change at the pace of garden setup and
 * the weather sweep — neither is worth a refetch on every window focus.
 */

const careRulesQueryKey = (gardenId: string) => ['care-rules', gardenId] as const;

const CARE_RULES_STALE_TIME_MS = 5 * 60 * 1000;

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export function useGardenCareRules(gardenId: string) {
  const gateway = useMemo(() => createCareRuleGateway(createBrowserApiClient()), []);

  return useQuery<GardenCareRulesResult, ApiFailureError>({
    queryKey: careRulesQueryKey(gardenId),
    queryFn: ({ signal }) => gateway.getGardenCareRules(gardenId, signal).then(unwrap),
    staleTime: CARE_RULES_STALE_TIME_MS,
  });
}
