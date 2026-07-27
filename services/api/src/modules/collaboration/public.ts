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
export type { ClientAccessGrantState } from './domain/client-access-grant-state.js';
export { isValidClientAccessGrantTransition } from './domain/client-access-grant-state.js';
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

// Publisher grant, work-log read, and the client-update publication
// workflow (P9C-PUBLISH-01, tag `Publications`) — the separate publisher
// capability and the internal_draft -> ready_for_client -> published ->
// withdrawn state machine ADR-0012 names.
export type {
  PublisherGrantDetail,
  PublisherGrantInsertInput,
  PublisherGrantRepository,
  PublisherGrantState,
} from './application/publisher-grant-repository.js';
export { PublisherAuthorization } from './application/publisher-authorization.js';
export { GrantPublisherAccess } from './application/grant-publisher-access.js';
export { RevokePublisherAccess } from './application/revoke-publisher-access.js';
export { ListPublisherGrantsForEngagement } from './application/list-publisher-grants-for-engagement.js';
export { KyselyPublisherGrantRepository } from './persistence/kysely-publisher-grant-repository.js';
export { registerPublisherGrantRoutes } from './transport/publisher-grant-routes.js';
export type { PublisherGrantRoutesDependencies } from './transport/publisher-grant-routes.js';

// Client invitation and access grant (P9C-INVITE-01, tag `ClientAccess`) —
// email-bound, expiring invitations completing `client_access_grant`.
export type { ClientAccessGrant } from './domain/client-access-grant.js';
export {
  assertClientAccessGrantAcceptable,
  assertClientEmailBindingSatisfied,
  createClientAccessGrantInvitation,
  isClientAccessGrantExpired,
  normalizeInvitedEmail,
  revokeClientAccessGrant,
} from './domain/client-access-grant.js';
export type { ClientAccessGrantRepository } from './application/client-access-grant-repository.js';
export {
  generateClientInvitationToken,
  hashClientInvitationToken,
} from './application/client-invitation-token.js';
export {
  buildClientInvitationAcceptUrl,
  buildClientInvitationEmailMessage,
} from './application/client-invitation-email-content.js';
export {
  CreateClientInvitation,
  CLIENT_INVITATION_TTL_MILLISECONDS,
} from './application/create-client-invitation.js';
export type { ClientInvitationEmailConfiguration } from './application/create-client-invitation.js';
export { AcceptClientInvitation } from './application/accept-client-invitation.js';
export type { AcceptClientInvitationActor } from './application/accept-client-invitation.js';
export { RevokeClientInvitation } from './application/revoke-client-invitation.js';
export { ListClientInvitationsForEngagement } from './application/list-client-invitations-for-engagement.js';
export { KyselyClientAccessGrantRepository } from './persistence/kysely-client-access-grant-repository.js';
export { registerClientInvitationRoutes } from './transport/client-invitation-routes.js';
export type { ClientInvitationRoutesDependencies } from './transport/client-invitation-routes.js';

export type { WorkLogDetail, WorkLogRepository } from './application/work-log-repository.js';
export { KyselyWorkLogRepository } from './persistence/kysely-work-log-repository.js';
export { ListEngagementWorkLogs } from './application/list-engagement-work-logs.js';
export { registerWorkLogRoutes } from './transport/work-log-routes.js';
export type { WorkLogRoutesDependencies } from './transport/work-log-routes.js';

export type {
  ClientUpdateDetail,
  ClientUpdateInsertInput,
  ClientUpdateRepository,
} from './application/client-update-repository.js';
export type {
  ClientUpdateItemDetail,
  ClientUpdateItemInsertInput,
  ClientUpdateItemKind,
  ClientUpdateItemRepository,
  PublicationMediaRole,
} from './application/client-update-item-repository.js';
export type {
  CreatePublicationVersionInput,
  PublicationGardenSnapshotItemInput,
  PublicationItemDetail,
  PublicationMediaItemInput,
  PublicationRepository,
  PublicationStaffAttributionDetail,
  PublicationStaffAttributionInput,
  PublicationTimelineEntryItemInput,
  PublicationVersionDetail,
  PublicationWorkLogItemInput,
} from './application/publication-repository.js';
export { KyselyClientUpdateRepository } from './persistence/kysely-client-update-repository.js';
export { KyselyClientUpdateItemRepository } from './persistence/kysely-client-update-item-repository.js';
export { KyselyPublicationRepository } from './persistence/kysely-publication-repository.js';
export { CreateClientUpdate } from './application/create-client-update.js';
export { GetClientUpdate } from './application/get-client-update.js';
export { ListClientUpdatesForEngagement } from './application/list-client-updates-for-engagement.js';
export { UpdateClientUpdateContent } from './application/update-client-update-content.js';
export type { UpdateClientUpdateContentInput } from './application/update-client-update-content.js';
export { AddClientUpdateItem } from './application/add-client-update-item.js';
export type { AddClientUpdateItemInput } from './application/add-client-update-item.js';
export { RemoveClientUpdateItem } from './application/remove-client-update-item.js';
export { SubmitClientUpdate } from './application/submit-client-update.js';
export { PublishClientUpdate } from './application/publish-client-update.js';
export type {
  PublishClientUpdateInput,
  PublishGardenSnapshotInput,
  PublishStaffAttributionRequestInput,
  PublishTimelineEntryInput,
} from './application/publish-client-update.js';
export { WithdrawClientUpdate } from './application/withdraw-client-update.js';
export { registerClientUpdateRoutes } from './transport/client-update-routes.js';
export type { ClientUpdateRoutesDependencies } from './transport/client-update-routes.js';
export { registerClientUpdateItemRoutes } from './transport/client-update-item-routes.js';
export type { ClientUpdateItemRoutesDependencies } from './transport/client-update-item-routes.js';

// The single aggregate registration call `app.ts` actually uses — see
// `publication-routes.ts`'s own header for why.
export { registerPublicationRoutes } from './transport/publication-routes.js';
export type { PublicationRoutesDependencies } from './transport/publication-routes.js';

// Client portal (P9C-API-01, tag `ClientPortal`) — publication-only client
// reads: which gardens the caller's own active grants cover, one garden's
// accepted-garden overview, its visible publications, and its factual
// timeline. The media-access route this tag also names lives in the media
// module instead (`GetClientMediaAccess`, P9C-MEDIA-01); this module owns
// only the four reads whose data it itself owns.
export { ClientPortalAuthorization } from './application/client-portal-authorization.js';
export type { ClientPublicationReadRepository } from './application/client-publication-read-repository.js';
export { KyselyClientPublicationReadRepository } from './persistence/kysely-client-publication-read-repository.js';
// `toClientPublicationSummaryResource` itself (not only the classes that use
// it) is exported for P9C-EXPORT-01: the client-export manifest reuses this
// exact shaping — the same restricted, client-safe projection
// `listClientPublications` already returns — for its own `publications`
// field, rather than a second copy of the same field-by-field omission list.
export { toClientPublicationSummaryResource } from './application/client-portal-view.js';
export { ListClientGardens } from './application/list-client-gardens.js';
export { GetClientGardenOverview } from './application/get-client-garden-overview.js';
export { ListClientPublications } from './application/list-client-publications.js';
export { GetClientTimeline } from './application/get-client-timeline.js';
export { registerClientPortalRoutes } from './transport/client-portal-routes.js';
export type { ClientPortalRoutesDependencies } from './transport/client-portal-routes.js';
