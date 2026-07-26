'use client';

import type {
  ChangeGardenMemberRoleRequest,
  CreateInvitationRequest,
  CreateInvitationResult,
  Garden,
  GardenMember,
  GardenMemberListResult,
  Invitation,
  InvitationListResult,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createCollaborationGateway,
  createGardenGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the member roster and invitation endpoints
 * (P9A-API-01). Owner-administration beyond editor/viewer (promote, demote,
 * ownership transfer) lives in `ownership-queries.ts` instead — mirrors the
 * gateway split, for the same reason.
 *
 * `useCallerRole` deliberately fetches the SAME `Garden` resource
 * `features/gardens/queries.ts`'s own `useGarden` does, under the identical
 * query key (`['gardens', gardenId]`). This is not a duplicate network
 * request in practice — TanStack Query's cache is global and keyed by this
 * array regardless of which file calls `useQuery` with it — it is a second,
 * independent hook so that `features/collaboration` never imports
 * `features/gardens` (architecture/web-application-design.md, section
 * "20. Dependency Rules": "Features import public Core and Shared
 * interfaces only").
 *
 * Source: architecture/web-application-design.md, section "8. API Access".
 */

const gardenQueryKey = (gardenId: string) => ['gardens', gardenId] as const;
const membersQueryKey = (gardenId: string) => ['gardens', gardenId, 'members'] as const;
const invitationsQueryKey = (gardenId: string) => ['gardens', gardenId, 'invitations'] as const;

function useGardenGateway() {
  return useMemo(() => createGardenGateway(createBrowserApiClient()), []);
}

function useCollaborationGateway() {
  return useMemo(() => createCollaborationGateway(createBrowserApiClient()), []);
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

export function useCallerRole(gardenId: string) {
  const gateway = useGardenGateway();

  return useQuery<Garden, ApiFailureError>({
    queryKey: gardenQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(gardenId, signal)),
  });
}

export function useGardenMembers(gardenId: string) {
  const gateway = useCollaborationGateway();

  return useQuery<GardenMemberListResult, ApiFailureError>({
    queryKey: membersQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.listMembers(gardenId, signal)),
  });
}

/**
 * Owner-only per `garden-capability-matrix.md` row H5 — pass `enabled: false`
 * for a non-owner caller so this never fires for a role the endpoint would
 * reject with `403`.
 */
export function useGardenInvitations(gardenId: string, options: { readonly enabled: boolean }) {
  const gateway = useCollaborationGateway();

  return useQuery<InvitationListResult, ApiFailureError>({
    queryKey: invitationsQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.listInvitations(gardenId, signal)),
    enabled: options.enabled,
  });
}

export function useCreateInvitation(gardenId: string) {
  const gateway = useCollaborationGateway();
  const queryClient = useQueryClient();

  return useMutation<CreateInvitationResult, ApiFailureError, CreateInvitationRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.createInvitation(gardenId, input, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationsQueryKey(gardenId) });
    },
  });
}

export function useRevokeInvitation(gardenId: string) {
  const gateway = useCollaborationGateway();
  const queryClient = useQueryClient();

  return useMutation<Invitation, ApiFailureError, string>({
    mutationFn: async (invitationId) =>
      unwrap(await gateway.revokeInvitation(gardenId, invitationId, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invitationsQueryKey(gardenId) });
    },
  });
}

export function useAcceptInvitation() {
  const gateway = useCollaborationGateway();

  return useMutation<GardenMember, ApiFailureError, string>({
    mutationFn: async (token) =>
      unwrap(await gateway.acceptInvitation(token, generateIdempotencyKey())),
  });
}

export interface ChangeMemberRoleVariables {
  readonly profileId: string;
  readonly role: ChangeGardenMemberRoleRequest['role'];
}

export function useChangeMemberRole(gardenId: string) {
  const gateway = useCollaborationGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenMember, ApiFailureError, ChangeMemberRoleVariables>({
    mutationFn: async ({ profileId, role }) =>
      unwrap(
        await gateway.changeMemberRole(gardenId, profileId, { role }, generateIdempotencyKey()),
      ),
    onSuccess: () => invalidateMembers(queryClient, gardenId),
  });
}

export function useRemoveMember(gardenId: string) {
  const gateway = useCollaborationGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenMember, ApiFailureError, string>({
    mutationFn: async (profileId) =>
      unwrap(await gateway.removeMember(gardenId, profileId, generateIdempotencyKey())),
    onSuccess: () => invalidateMembers(queryClient, gardenId),
  });
}
