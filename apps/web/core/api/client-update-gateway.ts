import type {
  AddClientUpdateItemRequest,
  ClientUpdate,
  ClientUpdateItem,
  ClientUpdateListResult,
  CreateClientUpdateRequest,
  PublicationVersion,
  PublishClientUpdateRequest,
  UpdateClientUpdateContentRequest,
  WithdrawClientUpdateRequest,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER, IF_MATCH_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface ClientUpdateGateway {
  list(engagementId: string, signal?: AbortSignal): Promise<ApiResult<ClientUpdateListResult>>;
  create(
    engagementId: string,
    input: CreateClientUpdateRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientUpdate>>;
  get(
    engagementId: string,
    clientUpdateId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientUpdate>>;
  updateContent(
    engagementId: string,
    clientUpdateId: string,
    input: UpdateClientUpdateContentRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientUpdate>>;
  submit(
    engagementId: string,
    clientUpdateId: string,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientUpdate>>;
  publish(
    engagementId: string,
    clientUpdateId: string,
    input: PublishClientUpdateRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PublicationVersion>>;
  withdraw(
    engagementId: string,
    clientUpdateId: string,
    input: WithdrawClientUpdateRequest,
    expectedRevision: number,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientUpdate>>;

  addItem(
    engagementId: string,
    clientUpdateId: string,
    input: AddClientUpdateItemRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientUpdateItem>>;
  removeItem(
    engagementId: string,
    clientUpdateId: string,
    itemId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientUpdateItem>>;
}

function idempotencyHeaders(idempotencyKey: string): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() };
}

function revisionHeaders(expectedRevision: number, idempotencyKey: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    [IF_MATCH_HEADER]: `"${String(expectedRevision)}"`,
    ...csrfHeader(),
  };
}

/**
 * Gateway for the client-update workflow (P9C-PUBLISH-01, tag
 * `Publications`): `internal_draft -> ready_for_client -> published ->
 * withdrawn`, plus staging/unstaging work-log, media, and observation
 * items on a draft. `publish` alone returns a `PublicationVersion`, not a
 * `ClientUpdate` — publishing produces a new immutable record rather than
 * mutating the draft in place.
 *
 * Every mutation but `create` carries both `Idempotency-Key` and `If-Match`
 * (the update's own `revision`) — the same `candidate-gateway.ts` shape,
 * since this is a revision-gated resource the same way a candidate is.
 * `addItem`/`removeItem` carry only `Idempotency-Key`: item mutations are
 * not revision-gated on the parent update (`client-update-item-routes.ts`'s
 * own shape).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Publications`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createClientUpdateGateway(client: ApiClient): ClientUpdateGateway {
  return {
    list(engagementId, signal) {
      return client.request<ClientUpdateListResult>({
        method: 'GET',
        path: `/client-engagements/${engagementId}/updates`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    create(engagementId, input, idempotencyKey, signal) {
      return client.request<ClientUpdate>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/updates`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    get(engagementId, clientUpdateId, signal) {
      return client.request<ClientUpdate>({
        method: 'GET',
        path: `/client-engagements/${engagementId}/updates/${clientUpdateId}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    updateContent(engagementId, clientUpdateId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<ClientUpdate>({
        method: 'PATCH',
        path: `/client-engagements/${engagementId}/updates/${clientUpdateId}`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    submit(engagementId, clientUpdateId, expectedRevision, idempotencyKey, signal) {
      return client.request<ClientUpdate>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/updates/${clientUpdateId}/submit`,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    publish(engagementId, clientUpdateId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<PublicationVersion>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/updates/${clientUpdateId}/publish`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    withdraw(engagementId, clientUpdateId, input, expectedRevision, idempotencyKey, signal) {
      return client.request<ClientUpdate>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/updates/${clientUpdateId}/withdraw`,
        body: input,
        headers: revisionHeaders(expectedRevision, idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    addItem(engagementId, clientUpdateId, input, idempotencyKey, signal) {
      return client.request<ClientUpdateItem>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/updates/${clientUpdateId}/items`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    removeItem(engagementId, clientUpdateId, itemId, idempotencyKey, signal) {
      return client.request<ClientUpdateItem>({
        method: 'DELETE',
        path: `/client-engagements/${engagementId}/updates/${clientUpdateId}/items/${itemId}`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
