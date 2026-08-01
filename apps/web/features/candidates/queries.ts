'use client';

import type {
  AddCandidateFromPhotoRequest,
  AddCandidateRequest,
  ConvertCandidateRequest,
  ConvertCandidateResult,
  PlantCandidate,
  PlantCandidateListResult,
  PlantCandidatePhoto,
  SetCandidateStatusRequest,
  SuitabilityAssessment,
  UpdateCandidateDetailsRequest,
} from '@verdery/api-contracts';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createCandidateGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
  type ListCandidatesParams,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the `PlantCandidates` endpoints.
 *
 * Mirrors `features/plants/queries.ts`: gateway wrapped in `useMemo`,
 * `unwrap` turns a typed `ApiResult` failure into `ApiFailureError`, and
 * every mutation folds its authoritative response back into the one
 * candidate query it affects with `setQueryData`. `useCandidateSuitability`
 * folds `plant_candidates.suitability_not_found` into a plain `null` success
 * value the same way `usePlantIdentification` treats "nothing pending" as an
 * ordinary state rather than a query error.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const candidateQueryKey = (gardenId: string, candidateId: string) =>
  ['candidates', gardenId, candidateId] as const;
const candidateListQueryKey = (gardenId: string, params: ListCandidatesParams) =>
  ['candidates', gardenId, 'list', params] as const;
const candidateSuitabilityQueryKey = (gardenId: string, candidateId: string) =>
  ['candidates', gardenId, candidateId, 'suitability'] as const;
const candidatePhotosQueryKey = (gardenId: string, candidateId: string) =>
  ['candidates', gardenId, candidateId, 'photos'] as const;

function useCandidateGateway() {
  return useMemo(() => createCandidateGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

/** Backs `candidate-list.tsx`. `params` is included in the query key so any filter change is a distinct cached page. */
export function useListCandidates(gardenId: string, params: ListCandidatesParams) {
  const gateway = useCandidateGateway();

  return useQuery<PlantCandidateListResult, ApiFailureError>({
    queryKey: candidateListQueryKey(gardenId, params),
    queryFn: async ({ signal }) => unwrap(await gateway.list(gardenId, params, signal)),
  });
}

export function useCandidate(gardenId: string, candidateId: string) {
  const gateway = useCandidateGateway();

  return useQuery<PlantCandidate, ApiFailureError>({
    queryKey: candidateQueryKey(gardenId, candidateId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(gardenId, candidateId, signal)),
  });
}

export function useAddCandidate(gardenId: string) {
  const gateway = useCandidateGateway();
  const queryClient = useQueryClient();

  return useMutation<PlantCandidate, ApiFailureError, AddCandidateRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.add(gardenId, input, generateIdempotencyKey())),
    onSuccess: (candidate) => {
      queryClient.setQueryData(candidateQueryKey(gardenId, candidate.id), candidate);
    },
  });
}

/** Backs `add-candidate-from-photo-panel.tsx` (P11-WEB-01). Same create-then-cache pattern as `useAddCandidate`. */
export function useAddCandidateFromPhoto(gardenId: string) {
  const gateway = useCandidateGateway();
  const queryClient = useQueryClient();

  return useMutation<PlantCandidate, ApiFailureError, AddCandidateFromPhotoRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.addFromPhoto(gardenId, input, generateIdempotencyKey())),
    onSuccess: (candidate) => {
      queryClient.setQueryData(candidateQueryKey(gardenId, candidate.id), candidate);
    },
  });
}

/** Backs a candidate's own photo display. Unpaginated — mirrors `usePlantPhotos`'s own note: a candidate's photo count is always small (today, at most one). */
export function useCandidatePhotos(gardenId: string, candidateId: string) {
  const gateway = useCandidateGateway();

  return useQuery<readonly PlantCandidatePhoto[], ApiFailureError>({
    queryKey: candidatePhotosQueryKey(gardenId, candidateId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.listPhotos(gardenId, candidateId, signal)).items,
  });
}

export interface UpdateCandidateDetailsVariables {
  readonly input: UpdateCandidateDetailsRequest;
  readonly expectedRevision: number;
}

export function useUpdateCandidateDetails(gardenId: string, candidateId: string) {
  const gateway = useCandidateGateway();
  const queryClient = useQueryClient();

  return useMutation<PlantCandidate, ApiFailureError, UpdateCandidateDetailsVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.updateDetails(
          gardenId,
          candidateId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (candidate) => {
      queryClient.setQueryData(candidateQueryKey(gardenId, candidateId), candidate);
    },
  });
}

export interface SetCandidateStatusVariables {
  readonly input: SetCandidateStatusRequest;
  readonly expectedRevision: number;
}

export function useSetCandidateStatus(gardenId: string, candidateId: string) {
  const gateway = useCandidateGateway();
  const queryClient = useQueryClient();

  return useMutation<PlantCandidate, ApiFailureError, SetCandidateStatusVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.setStatus(
          gardenId,
          candidateId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (candidate) => {
      queryClient.setQueryData(candidateQueryKey(gardenId, candidateId), candidate);
    },
  });
}

export interface ConvertCandidateVariables {
  readonly input: ConvertCandidateRequest;
  readonly expectedRevision: number;
}

/**
 * Converting produces both the new `Plant` and the now-`converted`
 * `PlantCandidate` in one response — folds the candidate half back into
 * cache the same way every other mutation here does; the plant half is left
 * for the caller to seed into `features/plants/queries.ts`'s own cache,
 * since this feature must not import that one directly (Dependency Rules).
 */
export function useConvertCandidate(gardenId: string, candidateId: string) {
  const gateway = useCandidateGateway();
  const queryClient = useQueryClient();

  return useMutation<ConvertCandidateResult, ApiFailureError, ConvertCandidateVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.convert(
          gardenId,
          candidateId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (result) => {
      queryClient.setQueryData(candidateQueryKey(gardenId, candidateId), result.candidate);
    },
  });
}

/**
 * The candidate's latest suitability assessment, if one has ever been
 * computed. `getCandidateSuitability` answers a generic `404 NotFound` (no
 * resource-specific error code exists for it in the contract) when no
 * assessment has ever been computed — folded into a plain `null` success
 * value rather than a query error, mirroring `usePlantIdentification`'s
 * treatment of "nothing pending" as an ordinary state of the resource.
 */
export function useCandidateSuitability(gardenId: string, candidateId: string, enabled = true) {
  const gateway = useCandidateGateway();

  return useQuery<SuitabilityAssessment | null, ApiFailureError>({
    queryKey: candidateSuitabilityQueryKey(gardenId, candidateId),
    queryFn: async ({ signal }) => {
      const result = await gateway.getSuitability(gardenId, candidateId, signal);
      if (isFailure(result) && result.status === 404) {
        return null;
      }
      return unwrap(result);
    },
    enabled,
  });
}

export function useRecalculateCandidateSuitability(gardenId: string, candidateId: string) {
  const gateway = useCandidateGateway();
  const queryClient = useQueryClient();

  return useMutation<SuitabilityAssessment, ApiFailureError, void>({
    mutationFn: async () => unwrap(await gateway.recalculateSuitability(gardenId, candidateId)),
    onSuccess: (assessment) => {
      queryClient.setQueryData(candidateSuitabilityQueryKey(gardenId, candidateId), assessment);
    },
  });
}
