import type {
  ChangeGardenMemberRoleRequest,
  GardenMember,
  IncomingOwnershipTransferListResult,
  OwnershipTransfer,
  TransferOwnershipRequest,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface OwnershipGateway {
  promoteMember(
    gardenId: string,
    profileId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenMember>>;
  demoteOwner(
    gardenId: string,
    profileId: string,
    input: ChangeGardenMemberRoleRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenMember>>;
  /** P9A-OWNER-02 — the garden-scoped read of its currently pending transfer, `404` when none exists. */
  getGardenOwnershipTransfer(
    gardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OwnershipTransfer>>;
  transferOwnership(
    gardenId: string,
    input: TransferOwnershipRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OwnershipTransfer>>;
  cancelOwnershipTransfer(
    gardenId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OwnershipTransfer>>;
  acceptOwnershipTransfer(
    gardenId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OwnershipTransfer>>;
  declineOwnershipTransfer(
    gardenId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OwnershipTransfer>>;
  /** P9A-OWNER-02 — every pending transfer, across every garden, addressed to the caller. Always `200`. */
  listIncomingOwnershipTransfers(
    signal?: AbortSignal,
  ): Promise<ApiResult<IncomingOwnershipTransferListResult>>;
}

function idempotencyHeaders(idempotencyKey: string): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() };
}

/**
 * Gateway for owner-administration endpoints (P9A-OWNER-01): promote a
 * member to co-owner, demote an owner, and the ownership-transfer
 * request/cancel/accept/decline set.
 *
 * A separate file from `collaboration-gateway.ts` rather than an addition to
 * it — mirrors the backend's own `ownership-routes.ts` split from
 * `member-routes.ts`, made for the identical reason: every operation here
 * carries RECENT-authentication and last-owner preconditions the plain
 * membership endpoints do not, except `acceptOwnershipTransfer` and
 * `declineOwnershipTransfer`, which are deliberately NOT recent-auth-gated
 * (the caller is only disposing of an offer addressed to themselves — see
 * `packages/api-contracts/openapi.yaml`'s operation descriptions for both).
 *
 * P9A-OWNER-02 closed the read gap this module's header used to describe
 * here: `getGardenOwnershipTransfer` reads a single garden's own currently
 * pending transfer (`404` when none exists, or when one exists but the
 * caller is neither the owner nor its named recipient), and
 * `listIncomingOwnershipTransfers` lists every pending transfer, across
 * every garden, addressed to the caller — always `200`, an empty `items`
 * array when nothing is pending. A client can now confirm "is one pending?"
 * without acting on it, in both directions. `features/collaboration
 * /ownership-transfer-panel.tsx` and `incoming-ownership-transfers.tsx` use
 * these instead of inferring a transfer's existence from a mutation's own
 * response.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Collaboration`;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer".
 */
export function createOwnershipGateway(client: ApiClient): OwnershipGateway {
  return {
    promoteMember(gardenId, profileId, idempotencyKey, signal) {
      return client.request<GardenMember>({
        method: 'POST',
        path: `/gardens/${gardenId}/members/${profileId}/promote`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    demoteOwner(gardenId, profileId, input, idempotencyKey, signal) {
      return client.request<GardenMember>({
        method: 'POST',
        path: `/gardens/${gardenId}/members/${profileId}/demote`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    getGardenOwnershipTransfer(gardenId, signal) {
      return client.request<OwnershipTransfer>({
        method: 'GET',
        path: `/gardens/${gardenId}/ownership-transfer`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    transferOwnership(gardenId, input, idempotencyKey, signal) {
      return client.request<OwnershipTransfer>({
        method: 'POST',
        path: `/gardens/${gardenId}/ownership-transfer`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    cancelOwnershipTransfer(gardenId, idempotencyKey, signal) {
      return client.request<OwnershipTransfer>({
        method: 'DELETE',
        path: `/gardens/${gardenId}/ownership-transfer`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    acceptOwnershipTransfer(gardenId, idempotencyKey, signal) {
      return client.request<OwnershipTransfer>({
        method: 'POST',
        path: `/gardens/${gardenId}/ownership-transfer/accept`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    declineOwnershipTransfer(gardenId, idempotencyKey, signal) {
      return client.request<OwnershipTransfer>({
        method: 'POST',
        path: `/gardens/${gardenId}/ownership-transfer/decline`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listIncomingOwnershipTransfers(signal) {
      return client.request<IncomingOwnershipTransferListResult>({
        method: 'GET',
        path: '/ownership-transfers/incoming',
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
