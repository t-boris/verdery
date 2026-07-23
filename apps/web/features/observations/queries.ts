'use client';

import type {
  CorrectObservationRequest,
  Observation,
  ObservationListResult,
  RecordObservationRequest,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createObservationGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the observations-history endpoints.
 *
 * Mirrors `features/gardens/queries.ts`. `Observation` carries no revision —
 * it is immutable and append-only — so mutations invalidate the affected
 * list queries rather than folding a response into a single cached record.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const gardenObservationsQueryKey = (gardenId: string) =>
  ['observations', 'garden', gardenId] as const;
const plantObservationsQueryKey = (gardenId: string, plantId: string) =>
  ['observations', 'plant', gardenId, plantId] as const;

function useObservationGateway() {
  return useMemo(() => createObservationGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

export interface ObservationsListOptions {
  /** Set `false` to skip the request — used by `ObservationTimeline` to avoid firing the query it is not scoped to. */
  readonly enabled?: boolean;
}

export function useObservationsForGarden(gardenId: string, options?: ObservationsListOptions) {
  const gateway = useObservationGateway();

  return useQuery<ObservationListResult, ApiFailureError>({
    queryKey: gardenObservationsQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.listForGarden(gardenId, signal)),
    enabled: options?.enabled ?? true,
  });
}

export function useObservationsForPlant(
  gardenId: string,
  plantId: string,
  options?: ObservationsListOptions,
) {
  const gateway = useObservationGateway();

  return useQuery<ObservationListResult, ApiFailureError>({
    queryKey: plantObservationsQueryKey(gardenId, plantId),
    queryFn: async ({ signal }) => unwrap(await gateway.listForPlant(gardenId, plantId, signal)),
    enabled: options?.enabled ?? true,
  });
}

export function useRecordObservation(gardenId: string) {
  const gateway = useObservationGateway();
  const queryClient = useQueryClient();

  return useMutation<Observation, ApiFailureError, RecordObservationRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.record(gardenId, input, generateIdempotencyKey())),
    onSuccess: (observation) => {
      void queryClient.invalidateQueries({ queryKey: gardenObservationsQueryKey(gardenId) });
      if (observation.plantId !== null) {
        void queryClient.invalidateQueries({
          queryKey: plantObservationsQueryKey(gardenId, observation.plantId),
        });
      }
    },
  });
}

export interface CorrectObservationVariables {
  readonly observationId: string;
  readonly input: CorrectObservationRequest;
}

/**
 * `gardenId`/`plantId` are only used to invalidate the timeline this
 * correction was made from — `CorrectObservation` itself has no `gardenId`
 * in its path; the garden is resolved server-side from the original
 * observation.
 */
export function useCorrectObservation(gardenId: string, plantId: string | null) {
  const gateway = useObservationGateway();
  const queryClient = useQueryClient();

  return useMutation<Observation, ApiFailureError, CorrectObservationVariables>({
    mutationFn: async ({ observationId, input }) =>
      unwrap(await gateway.correct(observationId, input, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gardenObservationsQueryKey(gardenId) });
      if (plantId !== null) {
        void queryClient.invalidateQueries({
          queryKey: plantObservationsQueryKey(gardenId, plantId),
        });
      }
    },
  });
}
