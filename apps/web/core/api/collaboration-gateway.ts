import type {
  AcceptInvitationRequest,
  ChangeGardenMemberRoleRequest,
  CreateInvitationRequest,
  CreateInvitationResult,
  GardenMember,
  GardenMemberListResult,
  Invitation,
  InvitationListResult,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface CollaborationGateway {
  createInvitation(
    gardenId: string,
    input: CreateInvitationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<CreateInvitationResult>>;
  listInvitations(gardenId: string, signal?: AbortSignal): Promise<ApiResult<InvitationListResult>>;
  revokeInvitation(
    gardenId: string,
    invitationId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<Invitation>>;
  acceptInvitation(
    token: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenMember>>;
  listMembers(gardenId: string, signal?: AbortSignal): Promise<ApiResult<GardenMemberListResult>>;
  changeMemberRole(
    gardenId: string,
    profileId: string,
    input: ChangeGardenMemberRoleRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenMember>>;
  removeMember(
    gardenId: string,
    profileId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenMember>>;
}

function idempotencyHeaders(idempotencyKey: string): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() };
}

/**
 * Gateway for the invitation and member-roster endpoints (P9A-API-01).
 *
 * `acceptInvitation` is the one operation here not scoped under
 * `/gardens/{gardenId}` — the contract identifies it by the caller's own
 * session plus the token alone, since the whole point is that the caller
 * does not yet have membership (or any other relationship) to the garden
 * the token names.
 *
 * Owner-administration of roles beyond editor/viewer (promote, demote,
 * ownership transfer) lives in `ownership-gateway.ts` instead of here — the
 * same file split `services/api/src/modules/gardens-mapping/transport/`
 * already makes between `member-routes.ts` and `ownership-routes.ts`, for
 * the same reason: a distinct recent-auth precondition applies to that
 * whole other file and not to this one.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createCollaborationGateway(client: ApiClient): CollaborationGateway {
  return {
    createInvitation(gardenId, input, idempotencyKey, signal) {
      return client.request<CreateInvitationResult>({
        method: 'POST',
        path: `/gardens/${gardenId}/invitations`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listInvitations(gardenId, signal) {
      return client.request<InvitationListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/invitations`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    revokeInvitation(gardenId, invitationId, idempotencyKey, signal) {
      return client.request<Invitation>({
        method: 'POST',
        path: `/gardens/${gardenId}/invitations/${invitationId}/revoke`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    acceptInvitation(token, idempotencyKey, signal) {
      const body: AcceptInvitationRequest = { token };
      return client.request<GardenMember>({
        method: 'POST',
        path: '/invitations/accept',
        body,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listMembers(gardenId, signal) {
      return client.request<GardenMemberListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/members`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    changeMemberRole(gardenId, profileId, input, idempotencyKey, signal) {
      return client.request<GardenMember>({
        method: 'PATCH',
        path: `/gardens/${gardenId}/members/${profileId}`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    removeMember(gardenId, profileId, idempotencyKey, signal) {
      return client.request<GardenMember>({
        method: 'DELETE',
        path: `/gardens/${gardenId}/members/${profileId}`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
