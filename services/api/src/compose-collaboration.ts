/**
 * Composition-root helper for the collaboration module's professional-
 * service domain (P9B-API-01): service organizations, organization
 * membership, garden assignment, and client engagement lifecycle — plus the
 * separate publisher capability and client-update publication workflow
 * (P9C-PUBLISH-01) — split out of `app.ts` purely to keep that file at or
 * below the repository's 600-line source-file limit, the same reason
 * `compose-gardens-mapping.ts` was split out.
 *
 * Reuses `gardenAuthorization` (constructed once by `composeGardensMapping`
 * and threaded through every module that depends on it) and
 * `profileRepository` (constructed once in `app.ts` for session
 * provisioning) rather than building second instances of either.
 * Constructs its OWN `KyselyGardenRepository(database.queries)` for the
 * plain, non-authorization-gated garden-existence checks
 * `CreateGardenAssignment`/`CreateClientEngagement` need — a second,
 * independent read-only wrapper over the same pooled connection, the same
 * "no shared-single-instance requirement for a stateless reader" posture
 * `compose-gardens-mapping.ts`'s own file already takes for
 * `KyselyMembershipRepository`, constructed there more than once over the
 * same pool.
 *
 * Source: architecture/backend-modular-monolith.md, section "9. Composition Root".
 */

import {
  ActivateClientEngagement,
  AddClientUpdateItem,
  AddOrganizationMember,
  ChangeOrganizationMemberRole,
  CreateClientEngagement,
  CreateClientUpdate,
  CreateGardenAssignment,
  CreateServiceOrganization,
  EndClientEngagement,
  EndGardenAssignment,
  GetClientUpdate,
  GetOrganization,
  GrantPublisherAccess,
  KyselyClientEngagementRepository,
  KyselyClientUpdateItemRepository,
  KyselyClientUpdateRepository,
  KyselyCollaborationUnitOfWork,
  KyselyGardenAssignmentRepository,
  KyselyOrganizationMembershipRepository,
  KyselyOrganizationRepository,
  KyselyPublisherGrantRepository,
  KyselyWorkLogRepository,
  ListClientEngagementsForGarden,
  ListClientEngagementsForOrganization,
  ListClientUpdatesForEngagement,
  ListEngagementWorkLogs,
  ListGardenAssignmentsForGarden,
  ListGardenAssignmentsForOrganization,
  ListOrganizationMembers,
  ListOrganizations,
  ListPublisherGrantsForEngagement,
  OrganizationAuthorization,
  PublishClientUpdate,
  PublisherAuthorization,
  RemoveClientUpdateItem,
  RemoveOrganizationMember,
  RevokeClientEngagement,
  RevokeGardenAssignment,
  RevokePublisherAccess,
  SubmitClientUpdate,
  UpdateClientUpdateContent,
  WithdrawClientUpdate,
} from './modules/collaboration/public.js';
import type {
  ClientEngagementRoutesDependencies,
  ClientUpdateItemRoutesDependencies,
  ClientUpdateRoutesDependencies,
  GardenAssignmentRoutesDependencies,
  GardenScopedRoutesDependencies,
  OrganizationMemberRoutesDependencies,
  OrganizationRoutesDependencies,
  PublicationRoutesDependencies,
  PublisherGrantRoutesDependencies,
  WorkLogRoutesDependencies,
} from './modules/collaboration/public.js';
import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import { KyselyGardenRepository } from './modules/gardens-mapping/public.js';
import type { ProfileRepository } from './modules/identity-access/public.js';
import { KyselyMediaRepository } from './modules/media/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from './shared/time/clock.js';

export interface CollaborationComposition {
  readonly organizationRoutesDependencies: OrganizationRoutesDependencies;
  readonly organizationMemberRoutesDependencies: OrganizationMemberRoutesDependencies;
  readonly gardenAssignmentRoutesDependencies: GardenAssignmentRoutesDependencies;
  readonly clientEngagementRoutesDependencies: ClientEngagementRoutesDependencies;
  readonly gardenScopedRoutesDependencies: GardenScopedRoutesDependencies;
  readonly publicationRoutesDependencies: PublicationRoutesDependencies;
}

export function composeCollaboration(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  profileRepository: ProfileRepository,
): CollaborationComposition {
  const gardenRepository = new KyselyGardenRepository(database.queries);
  const organizationMembershipRepository = new KyselyOrganizationMembershipRepository(
    database.queries,
  );
  const organizationAuthorization = new OrganizationAuthorization(organizationMembershipRepository);
  const collaborationIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const collaborationUnitOfWork = new KyselyCollaborationUnitOfWork(database.queries, clock);
  // P9C-PUBLISH-01: the separate publisher capability, work-log reads, and
  // the client-update publication workflow. `mediaRepository` is this
  // module's OWN narrow read-only wrapper (P9C-PUBLISH-01 validates a
  // selected media record's existence/garden at publish time; it does not
  // build media authorization — that is P9C-MEDIA-01's own, concurrently-
  // scoped module) — the same "second independent reader over the same
  // pool" posture `gardenRepository` above already takes.
  const clientEngagementRepository = new KyselyClientEngagementRepository(database.queries);
  const publisherAuthorization = new PublisherAuthorization(
    new KyselyPublisherGrantRepository(database.queries),
  );
  const clientUpdateRepository = new KyselyClientUpdateRepository(database.queries);
  const clientUpdateItemRepository = new KyselyClientUpdateItemRepository(database.queries);
  const workLogRepository = new KyselyWorkLogRepository(database.queries);
  const mediaRepository = new KyselyMediaRepository(database.queries);

  const organizationRoutesDependencies: OrganizationRoutesDependencies = {
    createServiceOrganization: new CreateServiceOrganization(
      collaborationIdempotency,
      collaborationUnitOfWork,
      clock,
    ),
    listOrganizations: new ListOrganizations(new KyselyOrganizationRepository(database.queries)),
    getOrganization: new GetOrganization(
      new KyselyOrganizationRepository(database.queries),
      organizationAuthorization,
    ),
  };

  const organizationMemberRoutesDependencies: OrganizationMemberRoutesDependencies = {
    listOrganizationMembers: new ListOrganizationMembers(
      new KyselyOrganizationMembershipRepository(database.queries),
      organizationAuthorization,
    ),
    addOrganizationMember: new AddOrganizationMember(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      profileRepository,
      clock,
    ),
    changeOrganizationMemberRole: new ChangeOrganizationMemberRole(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      clock,
    ),
    removeOrganizationMember: new RemoveOrganizationMember(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      clock,
    ),
  };

  const gardenAssignmentRoutesDependencies: GardenAssignmentRoutesDependencies = {
    createGardenAssignment: new CreateGardenAssignment(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      gardenRepository,
      clock,
    ),
    listGardenAssignmentsForOrganization: new ListGardenAssignmentsForOrganization(
      new KyselyGardenAssignmentRepository(database.queries),
      organizationAuthorization,
    ),
    endGardenAssignment: new EndGardenAssignment(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      clock,
    ),
    revokeGardenAssignment: new RevokeGardenAssignment(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      clock,
    ),
  };

  const clientEngagementRoutesDependencies: ClientEngagementRoutesDependencies = {
    listClientEngagementsForOrganization: new ListClientEngagementsForOrganization(
      new KyselyClientEngagementRepository(database.queries),
      organizationAuthorization,
    ),
    createClientEngagement: new CreateClientEngagement(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      gardenAuthorization,
      gardenRepository,
      clock,
    ),
    activateClientEngagement: new ActivateClientEngagement(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      gardenAuthorization,
      clock,
    ),
    endClientEngagement: new EndClientEngagement(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      gardenAuthorization,
      clock,
    ),
    revokeClientEngagement: new RevokeClientEngagement(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      gardenAuthorization,
      clock,
    ),
  };

  const gardenScopedRoutesDependencies: GardenScopedRoutesDependencies = {
    listGardenAssignmentsForGarden: new ListGardenAssignmentsForGarden(
      new KyselyGardenAssignmentRepository(database.queries),
      gardenAuthorization,
    ),
    listClientEngagementsForGarden: new ListClientEngagementsForGarden(
      new KyselyClientEngagementRepository(database.queries),
      gardenAuthorization,
    ),
  };

  const publisherGrantRoutesDependencies: PublisherGrantRoutesDependencies = {
    listPublisherGrants: new ListPublisherGrantsForEngagement(
      new KyselyPublisherGrantRepository(database.queries),
      organizationAuthorization,
      gardenAuthorization,
      clientEngagementRepository,
    ),
    grantPublisherAccess: new GrantPublisherAccess(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      gardenAuthorization,
      clientEngagementRepository,
      organizationMembershipRepository,
      clock,
    ),
    revokePublisherAccess: new RevokePublisherAccess(
      collaborationIdempotency,
      collaborationUnitOfWork,
      organizationAuthorization,
      gardenAuthorization,
      clientEngagementRepository,
      clock,
    ),
  };

  const workLogRoutesDependencies: WorkLogRoutesDependencies = {
    listEngagementWorkLogs: new ListEngagementWorkLogs(
      clientEngagementRepository,
      workLogRepository,
      publisherAuthorization,
    ),
  };

  const clientUpdateRoutesDependencies: ClientUpdateRoutesDependencies = {
    listClientUpdates: new ListClientUpdatesForEngagement(
      clientEngagementRepository,
      clientUpdateRepository,
      clientUpdateItemRepository,
      publisherAuthorization,
    ),
    createClientUpdate: new CreateClientUpdate(
      collaborationIdempotency,
      collaborationUnitOfWork,
      publisherAuthorization,
      clientEngagementRepository,
      clock,
    ),
    getClientUpdate: new GetClientUpdate(
      clientEngagementRepository,
      clientUpdateRepository,
      clientUpdateItemRepository,
      publisherAuthorization,
    ),
    updateClientUpdateContent: new UpdateClientUpdateContent(
      collaborationIdempotency,
      collaborationUnitOfWork,
      publisherAuthorization,
      clientEngagementRepository,
      clientUpdateRepository,
      clock,
    ),
    submitClientUpdate: new SubmitClientUpdate(
      collaborationIdempotency,
      collaborationUnitOfWork,
      publisherAuthorization,
      clientEngagementRepository,
      clientUpdateRepository,
      clock,
    ),
    publishClientUpdate: new PublishClientUpdate(
      collaborationIdempotency,
      collaborationUnitOfWork,
      publisherAuthorization,
      clientEngagementRepository,
      clientUpdateRepository,
      mediaRepository,
      profileRepository,
      clock,
    ),
    withdrawClientUpdate: new WithdrawClientUpdate(
      collaborationIdempotency,
      collaborationUnitOfWork,
      publisherAuthorization,
      clientEngagementRepository,
      clientUpdateRepository,
      clock,
    ),
  };

  const clientUpdateItemRoutesDependencies: ClientUpdateItemRoutesDependencies = {
    addClientUpdateItem: new AddClientUpdateItem(
      collaborationIdempotency,
      collaborationUnitOfWork,
      publisherAuthorization,
      clientEngagementRepository,
      clientUpdateRepository,
      workLogRepository,
      mediaRepository,
      clock,
    ),
    removeClientUpdateItem: new RemoveClientUpdateItem(
      collaborationIdempotency,
      collaborationUnitOfWork,
      publisherAuthorization,
      clientEngagementRepository,
      clientUpdateRepository,
    ),
  };

  const publicationRoutesDependencies: PublicationRoutesDependencies = {
    publisherGrantRoutesDependencies,
    workLogRoutesDependencies,
    clientUpdateRoutesDependencies,
    clientUpdateItemRoutesDependencies,
  };

  return {
    organizationRoutesDependencies,
    organizationMemberRoutesDependencies,
    gardenAssignmentRoutesDependencies,
    clientEngagementRoutesDependencies,
    gardenScopedRoutesDependencies,
    publicationRoutesDependencies,
  };
}
