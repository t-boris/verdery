import type {
  ConvertRecommendationToTaskResult,
  PostponeRecommendationRequest,
  Recommendation,
  TodayResult,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface RecommendationGateway {
  getToday(
    gardenId: string,
    limit: number | null,
    signal?: AbortSignal,
  ): Promise<ApiResult<TodayResult>>;
  complete(
    gardenId: string,
    recommendationId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Recommendation>>;
  postpone(
    gardenId: string,
    recommendationId: string,
    input: PostponeRecommendationRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Recommendation>>;
  dismiss(
    gardenId: string,
    recommendationId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Recommendation>>;
  markIrrelevant(
    gardenId: string,
    recommendationId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Recommendation>>;
  convertToTask(
    gardenId: string,
    recommendationId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ConvertRecommendationToTaskResult>>;
}

function revisionHeaders(expectedRevision: number, idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    [IF_MATCH_HEADER]: `"${String(expectedRevision)}"`,
    ...csrfHeader(),
  };
}

/**
 * Gateway for the Recommendations operations: the Today read and the five
 * commands acting on a presented candidate.
 *
 * The Today GET is a plain read from the client's point of view, but the
 * server records FIRST PRESENTATION as a documented side effect — an
 * `eligible` candidate included in the response transitions to `presented`
 * in the same transaction that read it. The transition happens only on
 * first inclusion, so the request stays safely retryable and carries no
 * idempotency key; see the operation's own contract description.
 *
 * Every command is revision-guarded (`If-Match`) and idempotent
 * (`Idempotency-Key`), the exact header pairing `task-gateway.ts` uses for
 * task state transitions. `markIrrelevant` appends feedback WITHOUT a
 * lifecycle transition or revision bump — the response echoes the unchanged
 * recommendation.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Recommendations`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createRecommendationGateway(client: ApiClient): RecommendationGateway {
  return {
    getToday(gardenId, limit, signal) {
      const query = limit === null ? '' : `?limit=${String(limit)}`;
      return client.request<TodayResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/today${query}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    complete(gardenId, recommendationId, expectedRevision, idempotencyKey, signal) {
      return client.request<Recommendation>({
        method: 'POST',
        path: `/gardens/${gardenId}/recommendations/${recommendationId}/complete`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    postpone(gardenId, recommendationId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<Recommendation>({
        method: 'POST',
        path: `/gardens/${gardenId}/recommendations/${recommendationId}/postpone`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    dismiss(gardenId, recommendationId, expectedRevision, idempotencyKey, signal) {
      return client.request<Recommendation>({
        method: 'POST',
        path: `/gardens/${gardenId}/recommendations/${recommendationId}/dismiss`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    markIrrelevant(gardenId, recommendationId, expectedRevision, idempotencyKey, signal) {
      return client.request<Recommendation>({
        method: 'POST',
        path: `/gardens/${gardenId}/recommendations/${recommendationId}/mark-irrelevant`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    convertToTask(gardenId, recommendationId, expectedRevision, idempotencyKey, signal) {
      return client.request<ConvertRecommendationToTaskResult>({
        method: 'POST',
        path: `/gardens/${gardenId}/recommendations/${recommendationId}/convert-to-task`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
