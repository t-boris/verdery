import type {
  AddPlantFromPhotoRequest,
  AddPlantRequest,
  AttachPlantPhotoRequest,
  MovePlantRequest,
  Plant,
  PlantLifecycleStage,
  PlantPhoto,
  PlantStatus,
  TaxonomyReferenceListResult,
  UpdatePlantDetailsRequest,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface PlantGateway {
  add(
    gardenId: string,
    input: AddPlantRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Plant>>;
  addFromPhoto(
    gardenId: string,
    input: AddPlantFromPhotoRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Plant>>;
  get(gardenId: string, plantId: string, signal?: AbortSignal): Promise<ApiResult<Plant>>;
  updateDetails(
    gardenId: string,
    plantId: string,
    input: UpdatePlantDetailsRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Plant>>;
  attachPhoto(
    gardenId: string,
    plantId: string,
    input: AttachPlantPhotoRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantPhoto>>;
  setPrimaryPhoto(
    gardenId: string,
    plantId: string,
    plantPhotoId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantPhoto>>;
  confirmIdentification(
    gardenId: string,
    plantId: string,
    identificationId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Plant>>;
  transitionLifecycleStage(
    gardenId: string,
    plantId: string,
    stage: PlantLifecycleStage,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Plant>>;
  setStatus(
    gardenId: string,
    plantId: string,
    status: PlantStatus,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Plant>>;
  move(
    gardenId: string,
    plantId: string,
    input: MovePlantRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Plant>>;
  searchTaxonomyReferences(
    gardenId: string,
    query: string | null,
    limit: number | null,
    signal?: AbortSignal,
  ): Promise<ApiResult<TaxonomyReferenceListResult>>;
}

function revisionHeaders(expectedRevision: number, idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    [IF_MATCH_HEADER]: `"${String(expectedRevision)}"`,
    ...csrfHeader(),
  };
}

function taxonomySearchQuery(query: string | null, limit: number | null): string {
  const params = new URLSearchParams();
  if (query !== null) {
    params.set('query', query);
  }
  if (limit !== null) {
    params.set('limit', String(limit));
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/**
 * Gateway for the plants-inventory endpoints.
 *
 * `addFromPhoto`, `attachPhoto`, `setPrimaryPhoto`, and `confirmIdentification`
 * are implemented for contract completeness and are covered by
 * `plant-gateway.test.ts`, but no `features/plants` hook or component calls
 * them this pass: each needs a real `media` record, and this codebase has no
 * upload flow yet (`media.media_record` only records that a file reference
 * exists — see `docs/development/deferred-capabilities.md`). Wiring a control
 * that always fails would be a silently-broken UI, so these stay gateway-only
 * until Phase 6 media upload lands.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Plants`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createPlantGateway(client: ApiClient): PlantGateway {
  return {
    add(gardenId, input, idempotencyKey, signal) {
      return client.request<Plant>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    addFromPhoto(gardenId, input, idempotencyKey, signal) {
      return client.request<Plant>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants/from-photo`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    get(gardenId, plantId, signal) {
      return client.request<Plant>({
        method: 'GET',
        path: `/gardens/${gardenId}/plants/${plantId}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    updateDetails(gardenId, plantId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Plant>({
        method: 'PATCH',
        path: `/gardens/${gardenId}/plants/${plantId}`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    attachPhoto(gardenId, plantId, input, idempotencyKey, signal) {
      return client.request<PlantPhoto>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants/${plantId}/photos`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    setPrimaryPhoto(gardenId, plantId, plantPhotoId, idempotencyKey, signal) {
      return client.request<PlantPhoto>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants/${plantId}/photos/${plantPhotoId}/primary`,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    confirmIdentification(
      gardenId,
      plantId,
      identificationId,
      expectedRevision,
      idempotencyKey,
      signal,
    ) {
      return client.request<Plant>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants/${plantId}/identification/${identificationId}/confirm`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    transitionLifecycleStage(gardenId, plantId, stage, expectedRevision, idempotencyKey, signal) {
      return client.request<Plant>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants/${plantId}/lifecycle-stage`,
        body: { stage },
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    setStatus(gardenId, plantId, status, expectedRevision, idempotencyKey, signal) {
      return client.request<Plant>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants/${plantId}/status`,
        body: { status },
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    move(gardenId, plantId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Plant>({
        method: 'POST',
        path: `/gardens/${gardenId}/plants/${plantId}/move`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    searchTaxonomyReferences(gardenId, query, limit, signal) {
      return client.request<TaxonomyReferenceListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/taxonomy-references${taxonomySearchQuery(query, limit)}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
