import type {
  AddCandidateFromPhotoRequest,
  AddCandidateRequest,
  ConvertCandidateRequest,
  ConvertCandidateResult,
  PlantCandidate,
  PlantCandidateListResult,
  PlantCandidatePhotoListResult,
  PlantCandidatePriority,
  PlantCandidateStatus,
  SetCandidateStatusRequest,
  SuitabilityAssessment,
  UpdateCandidateDetailsRequest,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

/**
 * Every parameter `listCandidates` accepts, all optional — the same
 * trigram-fuzzy-`query`-plus-structured-filters-plus-cursor shape
 * `SearchPlantsParams` (`plant-gateway.ts`) already established for the
 * sibling `searchPlants` operation (P11-SEARCH-01 gave both the identical
 * treatment).
 */
export interface ListCandidatesParams {
  readonly query?: string | null;
  readonly status?: readonly PlantCandidateStatus[] | null;
  readonly priority?: readonly PlantCandidatePriority[] | null;
  readonly identified?: boolean | null;
  readonly cursor?: string | null;
  readonly limit?: number | null;
}

export interface CandidateGateway {
  add(
    gardenId: string,
    input: AddCandidateRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCandidate>>;
  addFromPhoto(
    gardenId: string,
    input: AddCandidateFromPhotoRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCandidate>>;
  listPhotos(
    gardenId: string,
    candidateId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCandidatePhotoListResult>>;
  list(
    gardenId: string,
    params: ListCandidatesParams,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCandidateListResult>>;
  get(
    gardenId: string,
    candidateId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCandidate>>;
  updateDetails(
    gardenId: string,
    candidateId: string,
    input: UpdateCandidateDetailsRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCandidate>>;
  setStatus(
    gardenId: string,
    candidateId: string,
    input: SetCandidateStatusRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantCandidate>>;
  convert(
    gardenId: string,
    candidateId: string,
    input: ConvertCandidateRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ConvertCandidateResult>>;
  getSuitability(
    gardenId: string,
    candidateId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<SuitabilityAssessment>>;
  /** No `Idempotency-Key`: recalculation is naturally safe to call repeatedly — see the contract's own operation description. */
  recalculateSuitability(
    gardenId: string,
    candidateId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<SuitabilityAssessment>>;
}

function revisionHeaders(expectedRevision: number, idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    [IF_MATCH_HEADER]: `"${String(expectedRevision)}"`,
    ...csrfHeader(),
  };
}

function listCandidatesQuery(params: ListCandidatesParams): string {
  const search = new URLSearchParams();
  if (params.query !== undefined && params.query !== null && params.query !== '') {
    search.set('query', params.query);
  }
  if (params.status !== undefined && params.status !== null && params.status.length > 0) {
    search.set('status', params.status.join(','));
  }
  if (params.priority !== undefined && params.priority !== null && params.priority.length > 0) {
    search.set('priority', params.priority.join(','));
  }
  if (params.identified !== undefined && params.identified !== null) {
    search.set('identified', String(params.identified));
  }
  if (params.cursor !== undefined && params.cursor !== null) {
    search.set('cursor', params.cursor);
  }
  if (params.limit !== undefined && params.limit !== null) {
    search.set('limit', String(params.limit));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * Gateway for the `PlantCandidates` endpoints (P11-API-01, P11-SEARCH-01,
 * P11-SUIT-01) — plants being CONSIDERED for a garden, distinct from actual
 * inventory (`plant-gateway.ts`). `getSuitability` answers `404` when no
 * assessment has ever been computed; `recalculateSuitability` is what a
 * client calls first, and again whenever garden context or the candidate's
 * own details change enough to warrant a fresh read. `addFromPhoto`/
 * `listPhotos` (P11-CAND-PHOTO-01) mirror `plant-gateway.ts`'s own
 * `addFromPhoto`/`listPhotos`, minus the separate confirm step a real plant
 * needs — see `AddCandidateFromPhoto`'s own header for why.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `PlantCandidates`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createCandidateGateway(client: ApiClient): CandidateGateway {
  return {
    add(gardenId, input, idempotencyKey, signal) {
      return client.request<PlantCandidate>({
        method: 'POST',
        path: `/gardens/${gardenId}/plant-candidates`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    addFromPhoto(gardenId, input, idempotencyKey, signal) {
      return client.request<PlantCandidate>({
        method: 'POST',
        path: `/gardens/${gardenId}/plant-candidates/from-photo`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listPhotos(gardenId, candidateId, signal) {
      return client.request<PlantCandidatePhotoListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/plant-candidates/${candidateId}/photos`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    list(gardenId, params, signal) {
      return client.request<PlantCandidateListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/plant-candidates${listCandidatesQuery(params)}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    get(gardenId, candidateId, signal) {
      return client.request<PlantCandidate>({
        method: 'GET',
        path: `/gardens/${gardenId}/plant-candidates/${candidateId}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    updateDetails(gardenId, candidateId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<PlantCandidate>({
        method: 'PATCH',
        path: `/gardens/${gardenId}/plant-candidates/${candidateId}`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    setStatus(gardenId, candidateId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<PlantCandidate>({
        method: 'POST',
        path: `/gardens/${gardenId}/plant-candidates/${candidateId}/status`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    convert(gardenId, candidateId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<ConvertCandidateResult>({
        method: 'POST',
        path: `/gardens/${gardenId}/plant-candidates/${candidateId}/convert`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    getSuitability(gardenId, candidateId, signal) {
      return client.request<SuitabilityAssessment>({
        method: 'GET',
        path: `/gardens/${gardenId}/plant-candidates/${candidateId}/suitability`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    recalculateSuitability(gardenId, candidateId, signal) {
      return client.request<SuitabilityAssessment>({
        method: 'POST',
        path: `/gardens/${gardenId}/plant-candidates/${candidateId}/suitability`,
        headers: { ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
