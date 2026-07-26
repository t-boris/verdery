/**
 * Composition-root helper for the collaboration module's professional-
 * service domain (P9B-API-01): service organizations, organization
 * membership, garden assignment, and client engagement lifecycle — split
 * out of `app.ts` purely to keep that file at or below the repository's
 * 600-line source-file limit, the same reason `compose-gardens-mapping.ts`
 * was split out.
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
  AddOrganizationMember,
  ChangeOrganizationMemberRole,
  CreateClientEngagement,
  CreateGardenAssignment,
  CreateServiceOrganization,
  EndClientEngagement,
  EndGardenAssignment,
  GetOrganization,
  KyselyClientEngagementRepository,
  KyselyCollaborationUnitOfWork,
  KyselyGardenAssignmentRepository,
  KyselyOrganizationMembershipRepository,
  KyselyOrganizationRepository,
  ListClientEngagementsForGarden,
  ListClientEngagementsForOrganization,
  ListGardenAssignmentsForGarden,
  ListGardenAssignmentsForOrganization,
  ListOrganizationMembers,
  ListOrganizations,
  OrganizationAuthorization,
  RemoveOrganizationMember,
  RevokeClientEngagement,
  RevokeGardenAssignment,
} from './modules/collaboration/public.js';
import type {
  ClientEngagementRoutesDependencies,
  GardenAssignmentRoutesDependencies,
  GardenScopedRoutesDependencies,
  OrganizationMemberRoutesDependencies,
  OrganizationRoutesDependencies,
} from './modules/collaboration/public.js';
import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import { KyselyGardenRepository } from './modules/gardens-mapping/public.js';
import type { ProfileRepository } from './modules/identity-access/public.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from './platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from './shared/time/clock.js';

export interface CollaborationComposition {
  readonly organizationRoutesDependencies: OrganizationRoutesDependencies;
  readonly organizationMemberRoutesDependencies: OrganizationMemberRoutesDependencies;
  readonly gardenAssignmentRoutesDependencies: GardenAssignmentRoutesDependencies;
  readonly clientEngagementRoutesDependencies: ClientEngagementRoutesDependencies;
  readonly gardenScopedRoutesDependencies: GardenScopedRoutesDependencies;
}

export function composeCollaboration(
  database: DatabaseGateway,
  clock: Clock,
  gardenAuthorization: GardenAuthorization,
  profileRepository: ProfileRepository,
): CollaborationComposition {
  const gardenRepository = new KyselyGardenRepository(database.queries);
  const organizationAuthorization = new OrganizationAuthorization(
    new KyselyOrganizationMembershipRepository(database.queries),
  );
  const collaborationIdempotency = new KyselyIdempotencyStore(database.queries, clock);
  const collaborationUnitOfWork = new KyselyCollaborationUnitOfWork(database.queries, clock);

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

  return {
    organizationRoutesDependencies,
    organizationMemberRoutesDependencies,
    gardenAssignmentRoutesDependencies,
    clientEngagementRoutesDependencies,
    gardenScopedRoutesDependencies,
  };
}
