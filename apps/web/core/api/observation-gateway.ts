import type {
  CorrectObservationRequest,
  Observation,
  ObservationListResult,
  RecordObservationRequest,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface ObservationGateway {
  record(
    gardenId: string,
    input: RecordObservationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Observation>>;
  listForGarden(gardenId: string, signal?: AbortSignal): Promise<ApiResult<ObservationListResult>>;
  listForPlant(
    gardenId: string,
    plantId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ObservationListResult>>;
  correct(
    observationId: string,
    input: CorrectObservationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Observation>>;
}

/**
 * Gateway for the observations-history endpoints.
 *
 * `record` never sends `photoMediaIds` from any current caller in
 * `features/observations`: this codebase has no upload flow yet, the same
 * gap `plant-gateway.ts`'s module doc comment explains, and
 * `RecordObservationRequest` already accepts a note and/or a condition
 * summary without a photo. `correct` carries no `If-Match`: `Observation` is
 * immutable and append-only, with no `revision` field to guard.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Observations`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createObservationGateway(client: ApiClient): ObservationGateway {
  return {
    record(gardenId, input, idempotencyKey, signal) {
      return client.request<Observation>({
        method: 'POST',
        path: `/gardens/${gardenId}/observations`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listForGarden(gardenId, signal) {
      return client.request<ObservationListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/observations`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listForPlant(gardenId, plantId, signal) {
      return client.request<ObservationListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/plants/${plantId}/observations`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    correct(observationId, input, idempotencyKey, signal) {
      return client.request<Observation>({
        method: 'POST',
        path: `/observations/${observationId}/corrections`,
        body: input,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
