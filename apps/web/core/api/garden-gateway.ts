import type { Garden, GardenListResult } from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface GardenGateway {
  list(cursor: string | null, signal?: AbortSignal): Promise<ApiResult<GardenListResult>>;
  create(name: string, idempotencyKey: string, signal?: AbortSignal): Promise<ApiResult<Garden>>;
  get(gardenId: string, signal?: AbortSignal): Promise<ApiResult<Garden>>;
  rename(
    gardenId: string,
    name: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Garden>>;
  archive(
    gardenId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Garden>>;
  requestDeletion(
    gardenId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Garden>>;
}

function revisionHeaders(expectedRevision: number, idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    [IF_MATCH_HEADER]: `"${String(expectedRevision)}"`,
    ...csrfHeader(),
  };
}

/**
 * Gateway for the garden lifecycle endpoints.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Gardens`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createGardenGateway(client: ApiClient): GardenGateway {
  return {
    list(cursor, signal) {
      const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      return client.request<GardenListResult>({
        method: 'GET',
        path: `/gardens${query}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    create(name, idempotencyKey, signal) {
      return client.request<Garden>({
        method: 'POST',
        path: '/gardens',
        body: { name },
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    get(gardenId, signal) {
      return client.request<Garden>({
        method: 'GET',
        path: `/gardens/${gardenId}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    rename(gardenId, name, expectedRevision, idempotencyKey, signal) {
      return client.request<Garden>({
        method: 'PATCH',
        path: `/gardens/${gardenId}`,
        body: { name },
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    archive(gardenId, expectedRevision, idempotencyKey, signal) {
      return client.request<Garden>({
        method: 'POST',
        path: `/gardens/${gardenId}/archive`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    requestDeletion(gardenId, expectedRevision, idempotencyKey, signal) {
      return client.request<Garden>({
        method: 'POST',
        path: `/gardens/${gardenId}/delete-request`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
