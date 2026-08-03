import type {
  CorrectObservationRequest,
  HealthSuggestionDisposition,
  ImageAnalysisResult,
  Observation,
  ObservationListResult,
  ObservationPhotoPurpose,
  PlantJournalFrameListResult,
  RecordObservationRequest,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

/**
 * `ListPlantJournalFrames`' two optional parameters. `purpose` narrows the
 * sequence to one kind of shot, which is what makes consecutive frames
 * comparable; `limit` is a bound on the sequence, not a page size — there is
 * no cursor here, and asking for fewer frames means asking for a shorter
 * sequence.
 */
export interface PlantJournalFramesParams {
  readonly purpose?: ObservationPhotoPurpose | null;
  readonly limit?: number | null;
}

function journalFramesQuery(params: PlantJournalFramesParams | undefined): string {
  const search = new URLSearchParams();
  if (params?.purpose !== undefined && params.purpose !== null) {
    search.set('purpose', params.purpose);
  }
  if (params?.limit !== undefined && params.limit !== null) {
    search.set('limit', String(params.limit));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

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
  /** `ListPlantJournalFrames` (P11-MEDIA-01) — a plant's photographs oldest-first, for reading growth as a sequence. A read of what exists; nothing is rendered server-side. */
  listJournalFrames(
    gardenId: string,
    plantId: string,
    params?: PlantJournalFramesParams,
    signal?: AbortSignal,
  ): Promise<ApiResult<PlantJournalFrameListResult>>;
  correct(
    observationId: string,
    input: CorrectObservationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Observation>>;
  /** `SetHealthSuggestionDisposition` (P11-HEALTH-01) — no `If-Match`: `image_analysis_result` carries no revision, and a disposition may be reconsidered freely. */
  setHealthSuggestionDisposition(
    analysisResultId: string,
    disposition: HealthSuggestionDisposition,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ImageAnalysisResult>>;
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

    listJournalFrames(gardenId, plantId, params, signal) {
      return client.request<PlantJournalFrameListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/plants/${plantId}/journal-frames${journalFramesQuery(params)}`,
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

    setHealthSuggestionDisposition(analysisResultId, disposition, idempotencyKey, signal) {
      return client.request<ImageAnalysisResult>({
        method: 'POST',
        path: `/observations/analysis-results/${analysisResultId}/disposition`,
        body: { disposition },
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
