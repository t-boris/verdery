'use client';

import type {
  ConvertRecommendationToTaskResult,
  PostponeRecommendationRequest,
  Recommendation,
  TodayResult,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createRecommendationGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the Recommendations operations.
 *
 * Mirrors `features/tasks/queries.ts`. Every command invalidates the garden's
 * Today query: complete, postpone, dismiss, and convert all end the item's
 * presence in the set, and even `markIrrelevant` (which changes no state)
 * refetches so the view keeps working from server truth rather than a local
 * echo. `useConvertRecommendationToTask` additionally invalidates the tasks
 * feature's `['tasks', gardenId]` prefix — the conversion CREATES a task, and
 * a stale tasks list that omits it would contradict the navigation the Today
 * view performs right after converting.
 *
 * Source: architecture/web-application-design.md, section "8. API Access";
 * packages/api-contracts/openapi.yaml, tag `Recommendations`.
 */

const todayQueryKey = (gardenId: string) => ['today', gardenId] as const;
/** The tasks feature's own list prefix — see `features/tasks/queries.ts`. */
const tasksBaseQueryKey = (gardenId: string) => ['tasks', gardenId] as const;

function useRecommendationGateway() {
  return useMemo(() => createRecommendationGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

function invalidateToday(queryClient: QueryClient, gardenId: string) {
  void queryClient.invalidateQueries({ queryKey: todayQueryKey(gardenId) });
}

export function useTodayRecommendations(gardenId: string) {
  const gateway = useRecommendationGateway();

  return useQuery<TodayResult, ApiFailureError>({
    queryKey: todayQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.getToday(gardenId, null, signal)),
  });
}

export function useCompleteRecommendation(gardenId: string, recommendationId: string) {
  const gateway = useRecommendationGateway();
  const queryClient = useQueryClient();

  return useMutation<Recommendation, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(
        await gateway.complete(
          gardenId,
          recommendationId,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateToday(queryClient, gardenId),
  });
}

export interface PostponeRecommendationVariables {
  readonly input: PostponeRecommendationRequest;
  readonly expectedRevision: number;
}

export function usePostponeRecommendation(gardenId: string, recommendationId: string) {
  const gateway = useRecommendationGateway();
  const queryClient = useQueryClient();

  return useMutation<Recommendation, ApiFailureError, PostponeRecommendationVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.postpone(
          gardenId,
          recommendationId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateToday(queryClient, gardenId),
  });
}

export function useDismissRecommendation(gardenId: string, recommendationId: string) {
  const gateway = useRecommendationGateway();
  const queryClient = useQueryClient();

  return useMutation<Recommendation, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(
        await gateway.dismiss(
          gardenId,
          recommendationId,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateToday(queryClient, gardenId),
  });
}

export function useMarkRecommendationIrrelevant(gardenId: string, recommendationId: string) {
  const gateway = useRecommendationGateway();
  const queryClient = useQueryClient();

  return useMutation<Recommendation, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(
        await gateway.markIrrelevant(
          gardenId,
          recommendationId,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateToday(queryClient, gardenId),
  });
}

export function useConvertRecommendationToTask(gardenId: string, recommendationId: string) {
  const gateway = useRecommendationGateway();
  const queryClient = useQueryClient();

  return useMutation<ConvertRecommendationToTaskResult, ApiFailureError, number>({
    mutationFn: async (expectedRevision) =>
      unwrap(
        await gateway.convertToTask(
          gardenId,
          recommendationId,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => {
      invalidateToday(queryClient, gardenId);
      void queryClient.invalidateQueries({ queryKey: tasksBaseQueryKey(gardenId) });
    },
  });
}
