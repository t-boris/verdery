/**
 * Public interface of the collaboration module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

// Domain vocabulary (P9B-DATA-01, wired up by P9B-API-01).
export type { OrganizationCapability, OrganizationRole } from './domain/organization-role.js';
export {
  organizationRoleHasCapability,
  ORGANIZATION_CAPABILITIES,
} from './domain/organization-role.js';
export type { GardenAssignmentState } from './domain/garden-assignment-state.js';
export { isValidGardenAssignmentTransition } from './domain/garden-assignment-state.js';
export type { ClientEngagementState } from './domain/client-engagement-state.js';
export { isValidClientEngagementTransition } from './domain/client-engagement-state.js';
export type { PublicationState } from './domain/publication-state.js';
export { isValidPublicationTransition } from './domain/publication-state.js';
export type { ServiceOrganization } from './domain/service-organization.js';
export {
  createServiceOrganization,
  validateOrganizationName,
} from './domain/service-organization.js';

export type { CollaborationDatabaseSchema } from './persistence/schema.js';

// Organization lifecycle.
export { OrganizationAuthorization } from './application/organization-authorization.js';
export type {
  OrganizationRepository,
  ServiceOrganizationWithCallerRole,
} from './application/organization-repository.js';
export type {
  OrganizationMembership,
  OrganizationMembershipDetail,
  OrganizationMembershipRepository,
  OrganizationMembershipState,
} from './application/organization-membership-repository.js';
export type {
  CollaborationTransactionContext,
  CollaborationUnitOfWork,
} from './application/collaboration-unit-of-work.js';
export { CreateServiceOrganization } from './application/create-service-organization.js';
export { ListOrganizations } from './application/list-organizations.js';
export { GetOrganization } from './application/get-organization.js';
export { ListOrganizationMembers } from './application/list-organization-members.js';
export { AddOrganizationMember } from './application/add-organization-member.js';
export { ChangeOrganizationMemberRole } from './application/change-organization-member-role.js';
export { RemoveOrganizationMember } from './application/remove-organization-member.js';
export { KyselyOrganizationRepository } from './persistence/kysely-organization-repository.js';
export { KyselyOrganizationMembershipRepository } from './persistence/kysely-organization-membership-repository.js';
export { KyselyCollaborationUnitOfWork } from './persistence/kysely-collaboration-unit-of-work.js';
export { registerOrganizationRoutes } from './transport/organization-routes.js';
export type { OrganizationRoutesDependencies } from './transport/organization-routes.js';
export { registerOrganizationMemberRoutes } from './transport/organization-member-routes.js';
export type { OrganizationMemberRoutesDependencies } from './transport/organization-member-routes.js';

// Garden assignment lifecycle — the ONLY mechanism through which
// organization membership becomes garden access (ADR-0012).
export type {
  GardenAssignmentDetail,
  GardenAssignmentInsertInput,
  GardenAssignmentRepository,
  GardenAssignmentRole,
} from './application/garden-assignment-repository.js';
export { CreateGardenAssignment } from './application/create-garden-assignment.js';
export { EndGardenAssignment } from './application/end-garden-assignment.js';
export { RevokeGardenAssignment } from './application/revoke-garden-assignment.js';
export { ListGardenAssignmentsForOrganization } from './application/list-garden-assignments-for-organization.js';
export { ListGardenAssignmentsForGarden } from './application/list-garden-assignments-for-garden.js';
export { KyselyGardenAssignmentRepository } from './persistence/kysely-garden-assignment-repository.js';
export { registerGardenAssignmentRoutes } from './transport/garden-assignment-routes.js';
export type { GardenAssignmentRoutesDependencies } from './transport/garden-assignment-routes.js';

// Client engagement lifecycle.
export type {
  ClientEngagementDetail,
  ClientEngagementInsertInput,
  ClientEngagementRepository,
  StewardshipPolicy,
} from './application/client-engagement-repository.js';
export { CreateClientEngagement } from './application/create-client-engagement.js';
export type { CreateClientEngagementInput } from './application/create-client-engagement.js';
export { ActivateClientEngagement } from './application/activate-client-engagement.js';
export { EndClientEngagement } from './application/end-client-engagement.js';
export { RevokeClientEngagement } from './application/revoke-client-engagement.js';
export { ListClientEngagementsForOrganization } from './application/list-client-engagements-for-organization.js';
export { ListClientEngagementsForGarden } from './application/list-client-engagements-for-garden.js';
export { KyselyClientEngagementRepository } from './persistence/kysely-client-engagement-repository.js';
export { registerClientEngagementRoutes } from './transport/client-engagement-routes.js';
export type { ClientEngagementRoutesDependencies } from './transport/client-engagement-routes.js';

// The two garden-scoped reads (tag `Collaboration`).
export { registerGardenScopedCollaborationRoutes } from './transport/garden-scoped-routes.js';
export type { GardenScopedRoutesDependencies } from './transport/garden-scoped-routes.js';
