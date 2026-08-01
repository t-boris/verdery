import type {
  GrantPublisherAccessRequest,
  PublisherGrant,
  PublisherGrantListResult,
  WorkLogListResult,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface PublisherGrantGateway {
  list(engagementId: string, signal?: AbortSignal): Promise<ApiResult<PublisherGrantListResult>>;
  grant(
    engagementId: string,
    input: GrantPublisherAccessRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PublisherGrant>>;
  revoke(
    engagementId: string,
    profileId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PublisherGrant>>;

  /** The candidate list a publisher stages work-log items from — same auth domain (an active publisher grant), kept in this gateway rather than a separate one. */
  listWorkLogs(engagementId: string, signal?: AbortSignal): Promise<ApiResult<WorkLogListResult>>;
}

function idempotencyHeaders(idempotencyKey: string): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() };
}

/**
 * Gateway for the publisher-grant admin surface and its own work-log read
 * (P9C-PUBLISH-01, tag `Publications`): who may draft/publish client
 * updates on an engagement, and the completed-work candidates a publisher
 * selects from. A separate gateway from `client-update-gateway.ts` — grants
 * are an engagement-admin concern (`manageEngagement`/`manageGarden`), while
 * the update workflow itself is gated on holding an ACTIVE grant, a
 * genuinely distinct capability (ADR-0012; `ClientUpdateErrorCode
 * .PublisherAccessRequired`'s own doc comment).
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Publications`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createPublisherGrantGateway(client: ApiClient): PublisherGrantGateway {
  return {
    list(engagementId, signal) {
      return client.request<PublisherGrantListResult>({
        method: 'GET',
        path: `/client-engagements/${engagementId}/publishers`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    grant(engagementId, input, idempotencyKey, signal) {
      return client.request<PublisherGrant>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/publishers`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    revoke(engagementId, profileId, idempotencyKey, signal) {
      return client.request<PublisherGrant>({
        method: 'DELETE',
        path: `/client-engagements/${engagementId}/publishers/${profileId}`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listWorkLogs(engagementId, signal) {
      return client.request<WorkLogListResult>({
        method: 'GET',
        path: `/client-engagements/${engagementId}/work-logs`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
