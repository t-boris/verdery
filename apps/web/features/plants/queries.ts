'use client';

import type {
  AddPlantFromPhotoRequest,
  AddPlantRequest,
  MovePlantRequest,
  Observation,
  Plant,
  PlantIdentification,
  PlantLifecycleStage,
  PlantListResult,
  PlantPhoto,
  PlantTaxonProfileResult,
  PlantStatus,
  TaxonomyReferenceListResult,
  UpdatePlantDetailsRequest,
} from '@verdery/api-contracts';
import { PlantErrorCode } from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createPlantGateway,
  createPlantCatalogGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
  type SearchPlantsParams,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the plants-inventory endpoints.
 *
 * Mirrors `features/gardens/queries.ts`: gateway wrapped in `useMemo`,
 * `unwrap` turns a typed `ApiResult` failure into `ApiFailureError`, and
 * every mutation folds its authoritative response back into the one plant
 * query it affects with `setQueryData`. `useSearchPlants` backs the garden
 * inventory list (`plant-list.tsx`) against `SearchPlants`
 * (`GET /gardens/{gardenId}/plants`, P4-SEARCH-01) — the endpoint this file
 * used to have no client for; see `docs/development/deferred-capabilities.md`
 * for the now-closed history of that gap.
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const plantQueryKey = (gardenId: string, plantId: string) => ['plants', gardenId, plantId] as const;
const plantIdentificationQueryKey = (gardenId: string, plantId: string) =>
  ['plants', gardenId, plantId, 'identification'] as const;
const plantPhotosQueryKey = (gardenId: string, plantId: string) =>
  ['plants', gardenId, plantId, 'photos'] as const;
const plantSearchQueryKey = (gardenId: string, params: SearchPlantsParams) =>
  ['plants', gardenId, 'search', params] as const;
const taxonomySearchQueryKey = (gardenId: string, query: string) =>
  ['taxonomy-references', gardenId, query] as const;
const taxonProfileQueryKey = (taxonomyReferenceId: string) =>
  ['plant-catalog', 'profile', taxonomyReferenceId] as const;
const TAXON_PROFILE_STALE_TIME_MS = 24 * 60 * 60 * 1000;
const TAXON_PROFILE_CACHE_TIME_MS = 7 * TAXON_PROFILE_STALE_TIME_MS;
const taxonomySearchQueryKeyPrefix = (gardenId: string) =>
  ['taxonomy-references', gardenId] as const;

function usePlantGateway() {
  return useMemo(() => createPlantGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

/**
 * Backs the garden inventory list (`plant-list.tsx`). `params` is included in
 * the query key so a change to any filter — the free-text query, a structured
 * filter, or the pagination cursor — is treated as a distinct cached page
 * rather than silently reusing a stale one, the same convention
 * `useTaxonomyReferenceSearch` below already follows for its own `query` key.
 */
export function useSearchPlants(gardenId: string, params: SearchPlantsParams) {
  const gateway = usePlantGateway();

  return useQuery<PlantListResult, ApiFailureError>({
    queryKey: plantSearchQueryKey(gardenId, params),
    queryFn: async ({ signal }) => unwrap(await gateway.search(gardenId, params, signal)),
  });
}

export function usePlant(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();

  return useQuery<Plant, ApiFailureError>({
    queryKey: plantQueryKey(gardenId, plantId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(gardenId, plantId, signal)),
  });
}

export function useAddPlant(gardenId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<Plant, ApiFailureError, AddPlantRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.add(gardenId, input, generateIdempotencyKey())),
    onSuccess: (plant) => {
      queryClient.setQueryData(plantQueryKey(gardenId, plant.id), plant);
      void queryClient.invalidateQueries({ queryKey: taxonomySearchQueryKeyPrefix(gardenId) });
    },
  });
}

/** Backs `add-plant-from-photo-form.tsx` (ADR-0015). Same create-then-cache pattern as `useAddPlant`. */
export function useAddPlantFromPhoto(gardenId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<Plant, ApiFailureError, AddPlantFromPhotoRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.addFromPhoto(gardenId, input, generateIdempotencyKey())),
    onSuccess: (plant) => {
      queryClient.setQueryData(plantQueryKey(gardenId, plant.id), plant);
      void queryClient.invalidateQueries({ queryKey: taxonomySearchQueryKeyPrefix(gardenId) });
    },
    // A large original may reach `available` before its analysis-sized
    // derivative exists. The API reports exactly this transient outcome;
    // keep the mutation pending and retry until the worker publishes the
    // derivative instead of presenting normal processing as a failed plant
    // creation. No other failure is retried.
    retry: (_failureCount, error) =>
      error.failure.code === 'plants_inventory.plant.identification_source_not_ready',
    retryDelay: 1000,
  });
}

export interface ConfirmPlantIdentificationVariables {
  readonly plantId: string;
  readonly identificationId: string;
  readonly expectedRevision: number;
}

/**
 * Confirming clears the plant's pending suggestion, so this also removes the
 * now-stale `usePlantIdentification` cache entry rather than leaving a
 * confirmed suggestion still readable as "pending" until its own (much
 * longer) staleness elapses.
 */
export function useConfirmPlantIdentification(gardenId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<Plant, ApiFailureError, ConfirmPlantIdentificationVariables>({
    mutationFn: async ({ plantId, identificationId, expectedRevision }) =>
      unwrap(
        await gateway.confirmIdentification(
          gardenId,
          plantId,
          identificationId,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (plant) => {
      queryClient.setQueryData(plantQueryKey(gardenId, plant.id), plant);
      queryClient.removeQueries({ queryKey: plantIdentificationQueryKey(gardenId, plant.id) });
      void queryClient.invalidateQueries({ queryKey: taxonomySearchQueryKeyPrefix(gardenId) });
      if (plant.taxonomyReferenceId !== null) {
        void queryClient.invalidateQueries({
          queryKey: taxonProfileQueryKey(plant.taxonomyReferenceId),
        });
      }
    },
  });
}

export interface RecordObservationFromIdentificationVariables {
  readonly plantId: string;
  readonly identificationId: string;
}

/**
 * Records the identification's already-computed condition analysis as a real
 * observation — independent of, and combinable with,
 * `useConfirmPlantIdentification` over the same row (ADR-0015's own
 * "AddPlantFromPhoto suggests an observation too" extension). Does not touch
 * the plant or identification query caches: this never changes either.
 */
export function useRecordObservationFromIdentification(gardenId: string) {
  const gateway = usePlantGateway();

  return useMutation<Observation, ApiFailureError, RecordObservationFromIdentificationVariables>({
    mutationFn: async ({ plantId, identificationId }) =>
      unwrap(
        await gateway.recordObservationFromIdentification(
          gardenId,
          plantId,
          identificationId,
          generateIdempotencyKey(),
        ),
      ),
  });
}

/**
 * The plant's still-pending photo-identification suggestion, if any — folds
 * `plants_inventory.plant.identification_not_found` into a plain `null`
 * success value rather than a query error, the same treatment
 * `useGardenOwnershipTransfer` gives an identically-shaped "pending, or
 * nothing to review" read (`features/collaboration/ownership-queries.ts`):
 * "nothing pending" is an ordinary state of this resource, not a failure
 * `FailureAlert` should ever render. Any OTHER failure (network, `401`,
 * `5xx`) still surfaces as a real query error.
 */
export function usePlantIdentification(gardenId: string, plantId: string, enabled = true) {
  const gateway = usePlantGateway();

  return useQuery<PlantIdentification | null, ApiFailureError>({
    queryKey: plantIdentificationQueryKey(gardenId, plantId),
    queryFn: async ({ signal }) => {
      const result = await gateway.getIdentification(gardenId, plantId, signal);
      if (isFailure(result) && result.code === PlantErrorCode.IdentificationNotFound) {
        return null;
      }
      return unwrap(result);
    },
    enabled,
  });
}

export interface UpdatePlantDetailsVariables {
  readonly input: UpdatePlantDetailsRequest;
  readonly expectedRevision: number;
}

export function useUpdatePlantDetails(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<Plant, ApiFailureError, UpdatePlantDetailsVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.updateDetails(
          gardenId,
          plantId,
          input,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (plant) => {
      queryClient.setQueryData(plantQueryKey(gardenId, plantId), plant);
    },
  });
}

export interface TransitionLifecycleStageVariables {
  readonly stage: PlantLifecycleStage;
  readonly expectedRevision: number;
}

export function useTransitionPlantLifecycleStage(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<Plant, ApiFailureError, TransitionLifecycleStageVariables>({
    mutationFn: async ({ stage, expectedRevision }) =>
      unwrap(
        await gateway.transitionLifecycleStage(
          gardenId,
          plantId,
          stage,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (plant) => {
      queryClient.setQueryData(plantQueryKey(gardenId, plantId), plant);
    },
  });
}

export interface SetPlantStatusVariables {
  readonly status: PlantStatus;
  readonly expectedRevision: number;
}

export function useSetPlantStatus(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<Plant, ApiFailureError, SetPlantStatusVariables>({
    mutationFn: async ({ status, expectedRevision }) =>
      unwrap(
        await gateway.setStatus(
          gardenId,
          plantId,
          status,
          expectedRevision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (plant) => {
      queryClient.setQueryData(plantQueryKey(gardenId, plantId), plant);
    },
  });
}

export interface MovePlantVariables {
  readonly input: MovePlantRequest;
  readonly expectedRevision: number;
}

export function useMovePlant(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<Plant, ApiFailureError, MovePlantVariables>({
    mutationFn: async ({ input, expectedRevision }) =>
      unwrap(
        await gateway.move(gardenId, plantId, input, expectedRevision, generateIdempotencyKey()),
      ),
    onSuccess: (plant) => {
      queryClient.setQueryData(plantQueryKey(gardenId, plantId), plant);
    },
  });
}

/** Backs `plant-photo-gallery.tsx`. Unpaginated — a plant's photo count is always small. */
export function usePlantPhotos(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();

  return useQuery<readonly PlantPhoto[], ApiFailureError>({
    queryKey: plantPhotosQueryKey(gardenId, plantId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.listPhotos(gardenId, plantId, signal)).items,
  });
}

/** Reference imagery and attributed source-backed or reviewed facts for an identified taxon. */
export function usePlantTaxonProfile(taxonomyReferenceId: string) {
  const gateway = useMemo(() => createPlantCatalogGateway(createBrowserApiClient()), []);

  return useQuery<PlantTaxonProfileResult, ApiFailureError>({
    queryKey: taxonProfileQueryKey(taxonomyReferenceId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.getTaxonProfile(taxonomyReferenceId, signal)),
    retry: false,
    staleTime: TAXON_PROFILE_STALE_TIME_MS,
    gcTime: TAXON_PROFILE_CACHE_TIME_MS,
    refetchOnWindowFocus: false,
  });
}

/** Upload is a separate media concern; this mutation attaches an already validated media record to the plant. */
export function useAttachPlantPhoto(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<PlantPhoto, ApiFailureError, { readonly mediaId: string }>({
    mutationFn: async ({ mediaId }) =>
      unwrap(
        await gateway.attachPhoto(
          gardenId,
          plantId,
          { mediaId, isPrimary: false },
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: plantPhotosQueryKey(gardenId, plantId) });
      await queryClient.invalidateQueries({ queryKey: ['plants', gardenId, 'search'] });
    },
  });
}

/** Makes one attached photo the plant cover and refreshes both the gallery and inventory thumbnails. */
export function useSetPrimaryPlantPhoto(gardenId: string, plantId: string) {
  const gateway = usePlantGateway();
  const queryClient = useQueryClient();

  return useMutation<PlantPhoto, ApiFailureError, { readonly plantPhotoId: string }>({
    mutationFn: async ({ plantPhotoId }) =>
      unwrap(
        await gateway.setPrimaryPhoto(gardenId, plantId, plantPhotoId, generateIdempotencyKey()),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: plantPhotosQueryKey(gardenId, plantId) });
      await queryClient.invalidateQueries({ queryKey: ['plants', gardenId, 'search'] });
    },
  });
}

/** Backs `TaxonomyReferenceField`'s search-select. An empty `query` lists the catalog, most recent first. */
export function useTaxonomyReferenceSearch(gardenId: string, query: string) {
  const gateway = usePlantGateway();
  const trimmed = query.trim();

  return useQuery<TaxonomyReferenceListResult, ApiFailureError>({
    queryKey: taxonomySearchQueryKey(gardenId, trimmed),
    queryFn: async ({ signal }) =>
      unwrap(
        await gateway.searchTaxonomyReferences(
          gardenId,
          trimmed === '' ? null : trimmed,
          null,
          signal,
        ),
      ),
  });
}
