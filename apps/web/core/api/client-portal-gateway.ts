import type {
  AcceptClientInvitationRequest,
  ClientAccessGrant,
  ClientGardenListResult,
  ClientGardenOverview,
  ClientPublicationListResult,
  ClientTimelineResult,
  MediaAccess,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

/**
 * Gateway for the read-only client-portal domain (P9C-API-01, tag
 * `ClientPortal`), plus `acceptClientInvitation` — tagged `ClientAccess`
 * (P9C-INVITE-01) in the contract, but declared here rather than in a
 * separate gateway file because it belongs to the same feature
 * (`features/client-portal`) and is the one write a not-yet-a-client caller
 * performs before every other method here becomes callable at all. This
 * mirrors `organization-gateway.ts`'s own precedent of one gateway per
 * feature directory spanning more than one contract tag, documented at each
 * method that crosses the seam.
 *
 * Every read is scoped ENTIRELY by the caller's own session plus, where
 * relevant, a `clientGardenId`/`publicationId`/`mediaId` the caller already
 * holds — never an operational identifier, per the contract's own tag
 * description ("authorization always starts from the current client profile
 * and active access grant").
 *
 * Source: packages/api-contracts/openapi.yaml, tags `ClientPortal`,
 * `ClientAccess`; architecture/web-application-design.md, section
 * "8. API Access"; architecture/collaboration-and-client-sharing.md,
 * sections "9. Client Invitation and Session", "13. API Surfaces".
 */
export interface ClientPortalGateway {
  /** `listClientGardens` — every engagement the caller currently holds an active client access grant on. No path/query parameter. */
  listClientGardens(signal?: AbortSignal): Promise<ApiResult<ClientGardenListResult>>;
  /** `getClientGardenOverview` — the accepted-garden snapshot from the latest publication that included one, if any. Snapshot fields are absent (not an error) when none has ever been published. */
  getClientGardenOverview(
    clientGardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientGardenOverview>>;
  /** `listClientPublications` — every visible (published, never withdrawn) publication version, newest first, each with its own item snapshots. */
  listClientPublications(
    clientGardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientPublicationListResult>>;
  /** `getClientTimeline` — the same visible items flattened into one chronological sequence, oldest first, with no version grouping. */
  getClientTimeline(
    clientGardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientTimelineResult>>;
  /** `getClientMediaAccess` — short-lived signed access to one entitled media object. `publicationId` mirrors the contract's own URL shape but is not itself an authorization input; `mediaId` alone decides access, re-verified fresh on every call. */
  getClientMediaAccess(
    publicationId: string,
    mediaId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<MediaAccess>>;
  /**
   * `acceptClientInvitation` (tag `ClientAccess`) — grants the authenticated
   * caller the invitation's client access grant. Identified by the token plus
   * the caller's own session, exactly like `acceptInvitation`; never scoped
   * under an engagement or garden path, since the whole point is that the
   * caller has no relationship to either yet.
   */
  acceptClientInvitation(
    token: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientAccessGrant>>;
}

export function createClientPortalGateway(client: ApiClient): ClientPortalGateway {
  return {
    listClientGardens(signal) {
      return client.request<ClientGardenListResult>({
        method: 'GET',
        path: '/client/gardens',
        ...(signal === undefined ? {} : { signal }),
      });
    },

    getClientGardenOverview(clientGardenId, signal) {
      return client.request<ClientGardenOverview>({
        method: 'GET',
        path: `/client/gardens/${clientGardenId}/overview`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listClientPublications(clientGardenId, signal) {
      return client.request<ClientPublicationListResult>({
        method: 'GET',
        path: `/client/gardens/${clientGardenId}/publications`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    getClientTimeline(clientGardenId, signal) {
      return client.request<ClientTimelineResult>({
        method: 'GET',
        path: `/client/gardens/${clientGardenId}/timeline`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    getClientMediaAccess(publicationId, mediaId, signal) {
      return client.request<MediaAccess>({
        method: 'GET',
        path: `/client/publications/${publicationId}/media/${mediaId}/access`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    acceptClientInvitation(token, idempotencyKey, signal) {
      const body: AcceptClientInvitationRequest = { token };
      return client.request<ClientAccessGrant>({
        method: 'POST',
        path: '/client-invitations/accept',
        body,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() },
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
