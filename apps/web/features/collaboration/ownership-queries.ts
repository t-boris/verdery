'use client';

import type {
  GardenMember,
  GardenRole,
  IncomingOwnershipTransferListResult,
  OwnershipTransfer,
} from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createOwnershipGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for owner administration (P9A-OWNER-01) and the
 * ownership-transfer reads P9A-OWNER-02 added: promote, demote, the
 * ownership-transfer request/cancel/accept/decline set, plus the
 * garden-scoped pending-transfer read and the cross-garden incoming list.
 *
 * `useGardenOwnershipTransfer` folds `collaboration.ownership_transfer.not_found`
 * into a plain `null` success value rather than surfacing it through
 * TanStack Query's error channel — "nothing pending" is an ordinary state of
 * this resource, not a failure `FailureAlert` should ever render. This is
 * the same treatment `ownership-transfer-panel.tsx` gave that one code
 * before this read existed, just moved from component logic into the query
 * itself; any OTHER failure (network, `401`, `5xx`) still surfaces as a real
 * query error. `useIncomingOwnershipTransfers` needs no such handling — its
 * endpoint is always `200`, an empty `items` array when nothing is pending.
 *
 * Every mutation that can leave "is a transfer pending" changed keeps the
 * affected read's cache correct without a network round trip: `setQueryData`
 * with the mutation's own response, the same pattern
 * `features/gardens/queries.ts` already uses for its own single-resource
 * writes. `acceptOwnershipTransfer`/`declineOwnershipTransfer` additionally
 * invalidate the cross-garden incoming list — accepting or declining
 * resolves an entry that list must stop showing — and, like `demoteOwner`,
 * invalidate the garden resource and member roster where the caller's OWN
 * role can change as a side effect (`acceptOwnershipTransfer` always changes
 * it; the others never do).
 *
 * Source: architecture/web-application-design.md, section "8. API Access";
 * packages/api-contracts/openapi.yaml, tag `Collaboration`.
 */

const gardenQueryKey = (gardenId: string) => ['gardens', gardenId] as const;
const membersQueryKey = (gardenId: string) => ['gardens', gardenId, 'members'] as const;
const gardenOwnershipTransferQueryKey = (gardenId: string) =>
  ['gardens', gardenId, 'ownership-transfer'] as const;
const INCOMING_OWNERSHIP_TRANSFERS_QUERY_KEY = ['ownership-transfers', 'incoming'] as const;

function useOwnershipGateway() {
  return useMemo(() => createOwnershipGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

function invalidateMembers(queryClient: QueryClient, gardenId: string) {
  void queryClient.invalidateQueries({ queryKey: membersQueryKey(gardenId) });
}

function invalidateMembersAndGarden(queryClient: QueryClient, gardenId: string) {
  invalidateMembers(queryClient, gardenId);
  void queryClient.invalidateQueries({ queryKey: gardenQueryKey(gardenId) });
}

function invalidateIncomingOwnershipTransfers(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: INCOMING_OWNERSHIP_TRANSFERS_QUERY_KEY });
}

export function usePromoteMember(gardenId: string) {
  const gateway = useOwnershipGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenMember, ApiFailureError, string>({
    mutationFn: async (profileId) =>
      unwrap(await gateway.promoteMember(gardenId, profileId, generateIdempotencyKey())),
    onSuccess: () => invalidateMembers(queryClient, gardenId),
  });
}

export interface DemoteMemberVariables {
  readonly profileId: string;
  readonly role: Exclude<GardenRole, 'owner'>;
}

export function useDemoteMember(gardenId: string) {
  const gateway = useOwnershipGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenMember, ApiFailureError, DemoteMemberVariables>({
    mutationFn: async ({ profileId, role }) =>
      unwrap(await gateway.demoteOwner(gardenId, profileId, { role }, generateIdempotencyKey())),
    onSuccess: () => invalidateMembersAndGarden(queryClient, gardenId),
  });
}

/**
 * The garden's own currently pending ownership transfer, or `null` when none
 * exists (or exists but is not addressed to the caller — the two are
 * indistinguishable by design, see `getGardenOwnershipTransfer`'s operation
 * description). Readable by the current owner or the transfer's named
 * recipient; `ownership-transfer-panel.tsx` uses this for both branches.
 */
export function useGardenOwnershipTransfer(gardenId: string) {
  const gateway = useOwnershipGateway();

  return useQuery<OwnershipTransfer | null, ApiFailureError>({
    queryKey: gardenOwnershipTransferQueryKey(gardenId),
    queryFn: async ({ signal }) => {
      const result = await gateway.getGardenOwnershipTransfer(gardenId, signal);
      if (isFailure(result) && result.code === CollaborationErrorCode.OwnershipTransferNotFound) {
        return null;
      }
      return unwrap(result);
    },
  });
}

/**
 * Every pending transfer, across every garden, addressed to the caller.
 * Backs `incoming-ownership-transfers.tsx`'s gardens-list banner — the
 * recipient-discoverability gap the panel's own module comment used to
 * describe as unbuildable before P9A-OWNER-02.
 */
export function useIncomingOwnershipTransfers() {
  const gateway = useOwnershipGateway();

  return useQuery<IncomingOwnershipTransferListResult, ApiFailureError>({
    queryKey: INCOMING_OWNERSHIP_TRANSFERS_QUERY_KEY,
    queryFn: async ({ signal }) => unwrap(await gateway.listIncomingOwnershipTransfers(signal)),
  });
}

export interface TransferOwnershipVariables {
  readonly toProfileId: string;
  readonly resultingRole: Exclude<GardenRole, 'owner'>;
}

export function useTransferOwnership(gardenId: string) {
  const gateway = useOwnershipGateway();
  const queryClient = useQueryClient();

  return useMutation<OwnershipTransfer, ApiFailureError, TransferOwnershipVariables>({
    mutationFn: async ({ toProfileId, resultingRole }) =>
      unwrap(
        await gateway.transferOwnership(
          gardenId,
          { toProfileId, resultingRole },
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: (transfer) => {
      queryClient.setQueryData<OwnershipTransfer | null>(
        gardenOwnershipTransferQueryKey(gardenId),
        transfer,
      );
    },
  });
}

export function useCancelOwnershipTransfer(gardenId: string) {
  const gateway = useOwnershipGateway();
  const queryClient = useQueryClient();

  return useMutation<OwnershipTransfer, ApiFailureError, void>({
    mutationFn: async () =>
      unwrap(await gateway.cancelOwnershipTransfer(gardenId, generateIdempotencyKey())),
    onSuccess: () => {
      queryClient.setQueryData<OwnershipTransfer | null>(
        gardenOwnershipTransferQueryKey(gardenId),
        null,
      );
    },
  });
}

export function useAcceptOwnershipTransfer(gardenId: string) {
  const gateway = useOwnershipGateway();
  const queryClient = useQueryClient();

  return useMutation<OwnershipTransfer, ApiFailureError, void>({
    mutationFn: async () =>
      unwrap(await gateway.acceptOwnershipTransfer(gardenId, generateIdempotencyKey())),
    onSuccess: () => {
      queryClient.setQueryData<OwnershipTransfer | null>(
        gardenOwnershipTransferQueryKey(gardenId),
        null,
      );
      invalidateMembersAndGarden(queryClient, gardenId);
      invalidateIncomingOwnershipTransfers(queryClient);
    },
  });
}

export function useDeclineOwnershipTransfer(gardenId: string) {
  const gateway = useOwnershipGateway();
  const queryClient = useQueryClient();

  return useMutation<OwnershipTransfer, ApiFailureError, void>({
    mutationFn: async () =>
      unwrap(await gateway.declineOwnershipTransfer(gardenId, generateIdempotencyKey())),
    onSuccess: () => {
      queryClient.setQueryData<OwnershipTransfer | null>(
        gardenOwnershipTransferQueryKey(gardenId),
        null,
      );
      invalidateIncomingOwnershipTransfers(queryClient);
    },
  });
}
