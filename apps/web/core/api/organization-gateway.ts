import type {
  AddOrganizationMemberRequest,
  ChangeOrganizationMemberRoleRequest,
  ClientEngagement,
  ClientEngagementListResult,
  CreateClientEngagementRequest,
  CreateGardenAssignmentRequest,
  CreateServiceOrganizationRequest,
  GardenAssignment,
  GardenAssignmentListResult,
  OrganizationMember,
  OrganizationMemberListResult,
  RevokeClientEngagementRequest,
  ServiceOrganization,
  ServiceOrganizationListResult,
} from '@verdery/api-contracts';
import { IDEMPOTENCY_KEY_HEADER } from '@verdery/api-contracts';

import type { ApiClient } from './client';
import { csrfHeader } from './csrf';
import type { ApiResult } from './result';

export interface OrganizationGateway {
  create(
    input: CreateServiceOrganizationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ServiceOrganization>>;
  list(signal?: AbortSignal): Promise<ApiResult<ServiceOrganizationListResult>>;
  get(organizationId: string, signal?: AbortSignal): Promise<ApiResult<ServiceOrganization>>;

  listMembers(
    organizationId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OrganizationMemberListResult>>;
  addMember(
    organizationId: string,
    input: AddOrganizationMemberRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OrganizationMember>>;
  changeMemberRole(
    organizationId: string,
    profileId: string,
    input: ChangeOrganizationMemberRoleRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OrganizationMember>>;
  removeMember(
    organizationId: string,
    profileId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<OrganizationMember>>;

  createGardenAssignment(
    organizationId: string,
    input: CreateGardenAssignmentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenAssignment>>;
  listOrganizationGardenAssignments(
    organizationId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenAssignmentListResult>>;
  endGardenAssignment(
    organizationId: string,
    assignmentId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenAssignment>>;
  revokeGardenAssignment(
    organizationId: string,
    assignmentId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenAssignment>>;

  listOrganizationClientEngagements(
    organizationId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientEngagementListResult>>;
  createClientEngagement(
    input: CreateClientEngagementRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientEngagement>>;
  activateClientEngagement(
    engagementId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientEngagement>>;
  endClientEngagement(
    engagementId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientEngagement>>;
  revokeClientEngagement(
    engagementId: string,
    input: RevokeClientEngagementRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientEngagement>>;

  /**
   * `GET /gardens/{gardenId}/assignments` — tagged `Collaboration` in the
   * contract (authorized as an ordinary garden read, `viewGarden`, open to
   * every active role) but reading rows that belong to this same
   * professional-service domain: "which gardens can this organization's
   * members reach" from the garden's own side. Declared here rather than in
   * `collaboration-gateway.ts` so `features/organizations` never depends on
   * `features/collaboration` for it.
   */
  listGardenAssignments(
    gardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<GardenAssignmentListResult>>;
  /**
   * `GET /gardens/{gardenId}/engagements` — same tag/domain split as
   * `listGardenAssignments` above, but `manageGarden`-gated (owner-only): an
   * engagement names a service-organization relationship and stewardship
   * policy, business-sensitive the way an invitation's intended email is,
   * not a plain membership fact every role may see.
   */
  listGardenClientEngagements(
    gardenId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<ClientEngagementListResult>>;
}

function idempotencyHeaders(idempotencyKey: string): Record<string, string> {
  return { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey, ...csrfHeader() };
}

/**
 * Gateway for the professional-service domain (P9B-API-01, tag
 * `Organizations`): service organizations, organization membership, garden
 * assignment, and client-engagement lifecycle — plus the two garden-scoped
 * reads the contract carries under tag `Collaboration` instead (see each
 * method's own comment above).
 *
 * One method per operation, `ApiResult<T>` returns, and idempotency-key
 * headers on every mutation — the exact shape `collaboration-gateway.ts` and
 * `ownership-gateway.ts` already establish, applied to this domain instead
 * of inventing a second convention.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Organizations`;
 * architecture/web-application-design.md, section "8. API Access".
 */
export function createOrganizationGateway(client: ApiClient): OrganizationGateway {
  return {
    create(input, idempotencyKey, signal) {
      return client.request<ServiceOrganization>({
        method: 'POST',
        path: '/service-organizations',
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    list(signal) {
      return client.request<ServiceOrganizationListResult>({
        method: 'GET',
        path: '/service-organizations',
        ...(signal === undefined ? {} : { signal }),
      });
    },

    get(organizationId, signal) {
      return client.request<ServiceOrganization>({
        method: 'GET',
        path: `/service-organizations/${organizationId}`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listMembers(organizationId, signal) {
      return client.request<OrganizationMemberListResult>({
        method: 'GET',
        path: `/service-organizations/${organizationId}/members`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    addMember(organizationId, input, idempotencyKey, signal) {
      return client.request<OrganizationMember>({
        method: 'POST',
        path: `/service-organizations/${organizationId}/members`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    changeMemberRole(organizationId, profileId, input, idempotencyKey, signal) {
      return client.request<OrganizationMember>({
        method: 'PATCH',
        path: `/service-organizations/${organizationId}/members/${profileId}`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    removeMember(organizationId, profileId, idempotencyKey, signal) {
      return client.request<OrganizationMember>({
        method: 'DELETE',
        path: `/service-organizations/${organizationId}/members/${profileId}`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    createGardenAssignment(organizationId, input, idempotencyKey, signal) {
      return client.request<GardenAssignment>({
        method: 'POST',
        path: `/service-organizations/${organizationId}/garden-assignments`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listOrganizationGardenAssignments(organizationId, signal) {
      return client.request<GardenAssignmentListResult>({
        method: 'GET',
        path: `/service-organizations/${organizationId}/garden-assignments`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    endGardenAssignment(organizationId, assignmentId, idempotencyKey, signal) {
      return client.request<GardenAssignment>({
        method: 'POST',
        path: `/service-organizations/${organizationId}/garden-assignments/${assignmentId}/end`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    revokeGardenAssignment(organizationId, assignmentId, idempotencyKey, signal) {
      return client.request<GardenAssignment>({
        method: 'POST',
        path: `/service-organizations/${organizationId}/garden-assignments/${assignmentId}/revoke`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listOrganizationClientEngagements(organizationId, signal) {
      return client.request<ClientEngagementListResult>({
        method: 'GET',
        path: `/service-organizations/${organizationId}/client-engagements`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    createClientEngagement(input, idempotencyKey, signal) {
      return client.request<ClientEngagement>({
        method: 'POST',
        path: '/client-engagements',
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    activateClientEngagement(engagementId, idempotencyKey, signal) {
      return client.request<ClientEngagement>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/activate`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    endClientEngagement(engagementId, idempotencyKey, signal) {
      return client.request<ClientEngagement>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/end`,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    revokeClientEngagement(engagementId, input, idempotencyKey, signal) {
      return client.request<ClientEngagement>({
        method: 'POST',
        path: `/client-engagements/${engagementId}/revoke`,
        body: input,
        headers: idempotencyHeaders(idempotencyKey),
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listGardenAssignments(gardenId, signal) {
      return client.request<GardenAssignmentListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/assignments`,
        ...(signal === undefined ? {} : { signal }),
      });
    },

    listGardenClientEngagements(gardenId, signal) {
      return client.request<ClientEngagementListResult>({
        method: 'GET',
        path: `/gardens/${gardenId}/engagements`,
        ...(signal === undefined ? {} : { signal }),
      });
    },
  };
}
