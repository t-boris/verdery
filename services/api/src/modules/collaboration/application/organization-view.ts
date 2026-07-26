/**
 * Maps domain/persistence shapes to the exact API contract shapes for
 * organizations and organization membership — the same "application code
 * returns the contract-shaped view" rule `gardens-mapping/application/
 * garden-view.ts` documents, so the idempotency store caches the literal
 * response a retried request must replay.
 */

import type {
  OrganizationMember,
  ServiceOrganization as ServiceOrganizationResource,
} from '@verdery/api-contracts';
import type { OrganizationRole } from '../domain/organization-role.js';
import type { OrganizationMembershipDetail } from './organization-membership-repository.js';
import type { ServiceOrganization } from '../domain/service-organization.js';

/** `collaboration.organization_membership.role` <-> the wire's camelCase enum — the same explicit mapping `garden-view.ts` applies to `deletion_requested` <-> `deletionRequested`. */
const ROLE_TO_WIRE: Readonly<Record<OrganizationRole, OrganizationMember['role']>> = {
  organization_admin: 'organizationAdmin',
  professional: 'professional',
};

const ROLE_FROM_WIRE: Readonly<Record<OrganizationMember['role'], OrganizationRole>> = {
  organizationAdmin: 'organization_admin',
  professional: 'professional',
};

export function toOrganizationRoleResource(role: OrganizationRole): OrganizationMember['role'] {
  return ROLE_TO_WIRE[role];
}

export function fromOrganizationRoleRequest(role: OrganizationMember['role']): OrganizationRole {
  return ROLE_FROM_WIRE[role];
}

export function toServiceOrganizationResource(
  organization: ServiceOrganization,
  callerRole: OrganizationRole,
): ServiceOrganizationResource {
  return {
    id: organization.id,
    name: organization.name,
    callerRole: toOrganizationRoleResource(callerRole),
    revision: organization.revision,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  };
}

export function toOrganizationMemberResource(
  membership: OrganizationMembershipDetail,
): OrganizationMember {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    profileId: membership.profileId,
    role: toOrganizationRoleResource(membership.role),
    state: membership.state,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}
