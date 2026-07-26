'use client';

import type {
  AddOrganizationMemberRequest,
  ClientEngagement,
  ClientEngagementListResult,
  CreateGardenAssignmentRequest,
  GardenAssignment,
  GardenAssignmentListResult,
  OrganizationMember,
  OrganizationMemberListResult,
  OrganizationRole,
  ServiceOrganization,
  ServiceOrganizationListResult,
} from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ApiFailureError,
  createBrowserApiClient,
  createOrganizationGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';

/**
 * TanStack Query hooks for the professional-service domain (P9B-API-01):
 * organizations, membership, garden assignment, and client engagement — the
 * same hooks-wrap-gateway shape `features/collaboration/queries.ts` and
 * `ownership-queries.ts` already establish, applied to this domain's own
 * gateway instead of inventing a second convention.
 *
 * `useGardenAssignmentsForGarden`/`useGardenClientEngagementsForGarden` back
 * the garden-settings read sections and use the SAME `['gardens', gardenId,
 * ...]` query-key shape `features/collaboration/queries.ts` already uses for
 * garden-scoped resources, for cache-key consistency across features — not
 * because either feature imports the other.
 *
 * Source: architecture/web-application-design.md, section "8. API Access";
 * packages/api-contracts/openapi.yaml, tag `Organizations`.
 */

const ORGANIZATIONS_QUERY_KEY = ['organizations'] as const;
const organizationQueryKey = (organizationId: string) => ['organizations', organizationId] as const;
const organizationMembersQueryKey = (organizationId: string) =>
  ['organizations', organizationId, 'members'] as const;
const organizationGardenAssignmentsQueryKey = (organizationId: string) =>
  ['organizations', organizationId, 'garden-assignments'] as const;
const organizationClientEngagementsQueryKey = (organizationId: string) =>
  ['organizations', organizationId, 'client-engagements'] as const;
const gardenAssignmentsQueryKey = (gardenId: string) =>
  ['gardens', gardenId, 'assignments'] as const;
const gardenEngagementsQueryKey = (gardenId: string) =>
  ['gardens', gardenId, 'engagements'] as const;

function useOrganizationGateway() {
  return useMemo(() => createOrganizationGateway(createBrowserApiClient()), []);
}

function unwrap<TData>(result: ApiResult<TData>): TData {
  if (isFailure(result)) {
    throw new ApiFailureError(result);
  }
  return result.data;
}

function invalidateMembers(queryClient: QueryClient, organizationId: string) {
  void queryClient.invalidateQueries({ queryKey: organizationMembersQueryKey(organizationId) });
}

function invalidateGardenAssignments(queryClient: QueryClient, organizationId: string) {
  void queryClient.invalidateQueries({
    queryKey: organizationGardenAssignmentsQueryKey(organizationId),
  });
}

function invalidateClientEngagements(queryClient: QueryClient, organizationId: string) {
  void queryClient.invalidateQueries({
    queryKey: organizationClientEngagementsQueryKey(organizationId),
  });
}

// --- Organizations ---------------------------------------------------------

export function useOrganizations() {
  const gateway = useOrganizationGateway();

  return useQuery<ServiceOrganizationListResult, ApiFailureError>({
    queryKey: ORGANIZATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => unwrap(await gateway.list(signal)),
  });
}

export function useOrganization(organizationId: string) {
  const gateway = useOrganizationGateway();

  return useQuery<ServiceOrganization, ApiFailureError>({
    queryKey: organizationQueryKey(organizationId),
    queryFn: async ({ signal }) => unwrap(await gateway.get(organizationId, signal)),
  });
}

export function useCreateOrganization() {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<ServiceOrganization, ApiFailureError, string>({
    mutationFn: async (name) => unwrap(await gateway.create({ name }, generateIdempotencyKey())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_KEY });
    },
  });
}

// --- Organization membership -------------------------------------------------

export function useOrganizationMembers(organizationId: string) {
  const gateway = useOrganizationGateway();

  return useQuery<OrganizationMemberListResult, ApiFailureError>({
    queryKey: organizationMembersQueryKey(organizationId),
    queryFn: async ({ signal }) => unwrap(await gateway.listMembers(organizationId, signal)),
  });
}

export function useAddOrganizationMember(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<OrganizationMember, ApiFailureError, AddOrganizationMemberRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.addMember(organizationId, input, generateIdempotencyKey())),
    onSuccess: () => invalidateMembers(queryClient, organizationId),
  });
}

export interface ChangeOrganizationMemberRoleVariables {
  readonly profileId: string;
  readonly role: OrganizationRole;
}

export function useChangeOrganizationMemberRole(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<OrganizationMember, ApiFailureError, ChangeOrganizationMemberRoleVariables>({
    mutationFn: async ({ profileId, role }) =>
      unwrap(
        await gateway.changeMemberRole(
          organizationId,
          profileId,
          { role },
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateMembers(queryClient, organizationId),
  });
}

export function useRemoveOrganizationMember(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<OrganizationMember, ApiFailureError, string>({
    mutationFn: async (profileId) =>
      unwrap(await gateway.removeMember(organizationId, profileId, generateIdempotencyKey())),
    onSuccess: () => invalidateMembers(queryClient, organizationId),
  });
}

// --- Garden assignments (organization's own view) ---------------------------

export function useOrganizationGardenAssignments(organizationId: string) {
  const gateway = useOrganizationGateway();

  return useQuery<GardenAssignmentListResult, ApiFailureError>({
    queryKey: organizationGardenAssignmentsQueryKey(organizationId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.listOrganizationGardenAssignments(organizationId, signal)),
  });
}

export function useCreateGardenAssignment(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenAssignment, ApiFailureError, CreateGardenAssignmentRequest>({
    mutationFn: async (input) =>
      unwrap(await gateway.createGardenAssignment(organizationId, input, generateIdempotencyKey())),
    onSuccess: () => invalidateGardenAssignments(queryClient, organizationId),
  });
}

export function useEndGardenAssignment(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenAssignment, ApiFailureError, string>({
    mutationFn: async (assignmentId) =>
      unwrap(
        await gateway.endGardenAssignment(organizationId, assignmentId, generateIdempotencyKey()),
      ),
    onSuccess: () => invalidateGardenAssignments(queryClient, organizationId),
  });
}

export function useRevokeGardenAssignment(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<GardenAssignment, ApiFailureError, string>({
    mutationFn: async (assignmentId) =>
      unwrap(
        await gateway.revokeGardenAssignment(
          organizationId,
          assignmentId,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateGardenAssignments(queryClient, organizationId),
  });
}

// --- Client engagements (organization's own view) ---------------------------

export function useOrganizationClientEngagements(organizationId: string) {
  const gateway = useOrganizationGateway();

  return useQuery<ClientEngagementListResult, ApiFailureError>({
    queryKey: organizationClientEngagementsQueryKey(organizationId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.listOrganizationClientEngagements(organizationId, signal)),
  });
}

/**
 * Always creates an ORGANIZATION-backed engagement — `serviceOrganizationId`
 * is filled in from this hook's own `organizationId` rather than exposed as
 * a form field, since this hook is only ever used from an organization's own
 * view. The self-run, no-organization posture `createClientEngagement`
 * also allows is out of this package's scope (see this feature's own
 * `public.ts` header).
 */
export function useCreateClientEngagement(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientEngagement, ApiFailureError, string>({
    mutationFn: async (gardenId) =>
      unwrap(
        await gateway.createClientEngagement(
          { gardenId, serviceOrganizationId: organizationId },
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateClientEngagements(queryClient, organizationId),
  });
}

export function useActivateClientEngagement(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientEngagement, ApiFailureError, string>({
    mutationFn: async (engagementId) =>
      unwrap(await gateway.activateClientEngagement(engagementId, generateIdempotencyKey())),
    onSuccess: () => invalidateClientEngagements(queryClient, organizationId),
  });
}

export function useEndClientEngagement(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientEngagement, ApiFailureError, string>({
    mutationFn: async (engagementId) =>
      unwrap(await gateway.endClientEngagement(engagementId, generateIdempotencyKey())),
    onSuccess: () => invalidateClientEngagements(queryClient, organizationId),
  });
}

export interface RevokeClientEngagementVariables {
  readonly engagementId: string;
  readonly reason?: string;
}

export function useRevokeClientEngagement(organizationId: string) {
  const gateway = useOrganizationGateway();
  const queryClient = useQueryClient();

  return useMutation<ClientEngagement, ApiFailureError, RevokeClientEngagementVariables>({
    mutationFn: async ({ engagementId, reason }) =>
      unwrap(
        await gateway.revokeClientEngagement(
          engagementId,
          reason === undefined ? {} : { reason },
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: () => invalidateClientEngagements(queryClient, organizationId),
  });
}

// --- Garden-side reads (garden settings page sibling sections) -------------

/** `viewGarden`-gated — every active role on the garden may read this. */
export function useGardenAssignmentsForGarden(gardenId: string) {
  const gateway = useOrganizationGateway();

  return useQuery<GardenAssignmentListResult, ApiFailureError>({
    queryKey: gardenAssignmentsQueryKey(gardenId),
    queryFn: async ({ signal }) => unwrap(await gateway.listGardenAssignments(gardenId, signal)),
  });
}

/** `manageGarden`-gated — owner-only, unlike `useGardenAssignmentsForGarden`. */
export function useGardenClientEngagementsForGarden(gardenId: string) {
  const gateway = useOrganizationGateway();

  return useQuery<ClientEngagementListResult, ApiFailureError>({
    queryKey: gardenEngagementsQueryKey(gardenId),
    queryFn: async ({ signal }) =>
      unwrap(await gateway.listGardenClientEngagements(gardenId, signal)),
  });
}
