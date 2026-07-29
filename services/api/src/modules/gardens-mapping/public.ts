/**
 * Public interface of the gardens-mapping module.
 *
 * Other modules and the composition root may import only from this file.
 *
 * Source: architecture/backend-modular-monolith.md, section "5.5 Public Interface".
 */

export type { Garden, GardenLifecycleState } from './domain/garden.js';
export type { GardenCapability, GardenRole } from './domain/garden-role.js';
// `roleHasCapability` is a pure predicate other modules' own boundary
// assertions need to declare and pin a required capability against (P9A-SYNC-01,
// G-8/G-9 in `docs/development/garden-capability-matrix.md`) — exported
// alongside the two types above rather than duplicated per module.
export { roleHasCapability } from './domain/garden-role.js';
export type { MapObject, MapObjectLifecycleState, MapObjectSummary } from './domain/map-object.js';
export { GardenAuthorization } from './application/garden-authorization.js';
export { ArchiveGarden } from './application/archive-garden.js';
export { CreateGarden } from './application/create-garden.js';
export type { GardenRepository } from './application/garden-repository.js';
export { GetGarden } from './application/get-garden.js';
export type { GardensMappingUnitOfWork } from './application/gardens-mapping-unit-of-work.js';
export { ListGardens } from './application/list-gardens.js';
export type {
  GardenAccess,
  GardenMembershipState,
  GardenPartitionMembership,
  Membership,
  MembershipDetail,
  MembershipRepository,
} from './application/membership-repository.js';
// P9B-API-02: the second, organization-assignment-sourced garden access
// path `GardenAuthorization` consults when ordinary membership grants
// nothing — see that port's own header for why it is a separate port
// rather than a change to `MembershipRepository.findGardenAccess`.
export type {
  GardenAssignmentAccess,
  GardenAssignmentAccessSource,
} from './application/garden-assignment-access-source.js';
export { KyselyGardenAssignmentAccessSource } from './persistence/kysely-garden-assignment-access-source.js';
export { RenameGarden } from './application/rename-garden.js';
export { RequestGardenDeletion } from './application/request-garden-deletion.js';
export { RestoreGardenDeletion } from './application/restore-garden-deletion.js';
// P8-DELETE-01: the membership half of deletion and recovery, reused by
// account deletion's ownership resolution and by the deletion purge.
export {
  activeOwners,
  restoreGardenMemberships,
  revokeGardenMemberships,
} from './application/garden-membership-revocation.js';
export type { MembershipRevocationPorts } from './application/garden-membership-revocation.js';
// P8-DELETE-01: the garden lifecycle transitions the deletion module drives
// through the same public `GardenRepository` port it already binds.
export {
  claimGardenForPurge,
  requestGardenDeletion as applyGardenDeletionRequest,
  restoreGarden as applyGardenRestore,
} from './domain/garden.js';
export { KyselyGardenRepository } from './persistence/kysely-garden-repository.js';
export { KyselyGardensMappingUnitOfWork } from './persistence/kysely-gardens-mapping-unit-of-work.js';
export { KyselyMembershipRepository } from './persistence/kysely-membership-repository.js';
export type { GardensMappingDatabaseSchema } from './persistence/schema.js';
export { registerGardenRoutes, UUID_PATTERN } from './transport/garden-routes.js';
export type { GardenRoutesDependencies } from './transport/garden-routes.js';

// Garden map (P3-BE-01, P3-BE-02).
export type {
  CalibrationRepository,
  Calibration,
  LegacyCalibrationReferencePoint,
} from './application/calibration-repository.js';
export type {
  CoordinateSpace,
  CoordinateSpaceRepository,
} from './application/coordinate-space-repository.js';
export type {
  Georeference,
  GeoreferenceRepository,
} from './application/georeference-repository.js';
export type {
  MapObjectRepository,
  ViewportBoundingBox,
} from './application/map-object-repository.js';
export type {
  GardenObjectResource,
  MapCommandResultResource,
} from './application/map-object-view.js';
// `toGardenObjectResource` itself (not only its type) is exported for
// P9C-EXPORT-01: the client-export manifest reuses this exact mapping for
// its own "accepted garden model" section rather than a second copy — see
// that command's own header.
export { toGardenObjectResource } from './application/map-object-view.js';
export type {
  GardenMapDocumentResource,
  GeoreferenceResource,
  ValidationIssueResource,
} from './application/get-garden-map.js';
export { toGeoreferenceResource } from './application/get-garden-map.js';
export type {
  RevisionJournalEntry,
  RevisionJournalWriter,
} from './application/revision-journal-writer.js';
export { AssignPlantToTarget } from './application/assign-plant-to-target.js';
export { ChangeMapObjectProperties } from './application/change-map-object-properties.js';
export { CreateMapObject } from './application/create-map-object.js';
export { DecideMapProposal } from './application/decide-map-proposal.js';
export { DeleteMapObject } from './application/delete-map-object.js';
export { DuplicateMapObject } from './application/duplicate-map-object.js';
export { EditMapObjectVertex } from './application/edit-map-object-vertex.js';
export { GetCalibration } from './application/get-calibration.js';
export { GetGardenMap } from './application/get-garden-map.js';
export { GetMapObject } from './application/get-map-object.js';
export { JoinMapObjectLinework } from './application/join-map-object-linework.js';
export { MoveMapObject } from './application/move-map-object.js';
export { ReplaceMapObjectGeometry } from './application/replace-map-object-geometry.js';
export { RestoreMapObject } from './application/restore-map-object.js';
export { SplitMapObjectLinework } from './application/split-map-object-linework.js';
export { UpsertMapCalibration } from './application/upsert-map-calibration.js';
export { KyselyCalibrationRepository } from './persistence/kysely-calibration-repository.js';
export { KyselyCoordinateSpaceRepository } from './persistence/kysely-coordinate-space-repository.js';
export { KyselyGeoreferenceRepository } from './persistence/kysely-georeference-repository.js';
export { KyselyMapObjectRepository } from './persistence/kysely-map-object-repository.js';
export { KyselyRevisionJournalWriter } from './persistence/kysely-revision-journal-writer.js';
export { registerMapRoutes } from './transport/map-routes.js';
export type { MapRoutesDependencies } from './transport/map-routes.js';

// Garden context facts (P9D-CONTEXT-01): reviewed or declared facts about a
// garden's physical growing environment — sun exposure, soil type,
// drainage, irrigation method, growing context, and microclimate — with
// their own source and quality. Exported narrowly: the repository type and
// the read command (`ListGardenContextFacts`) are the read port a future
// cross-module reader (`tasks-recommendations`'s rule engine, not built
// this pass) will need, the same narrow-read-port posture
// `GardenAssignmentAccessSource` already establishes in this module.
export type {
  DrainageValue,
  GardenContextFact,
  GardenContextFactProvenance,
  GardenContextFactValue,
  GardenContextKind,
  GardenContextSource,
  GrowingContextValue,
  IrrigationMethodValue,
  RecordGardenContextFactInput,
  SunExposureValue,
} from './domain/garden-context-fact.js';
export {
  GARDEN_CONTEXT_KINDS,
  validateGardenContextFactInput,
  validateGardenContextFactProvenance,
  validateGardenContextFactValue,
} from './domain/garden-context-fact.js';
export type { GardenContextFactRepository } from './application/garden-context-fact-repository.js';
export { ListGardenContextFacts } from './application/list-garden-context-facts.js';
export { RecordGardenContextFact } from './application/record-garden-context-fact.js';
export { toGardenContextFactResource } from './application/garden-context-fact-view.js';
export { KyselyGardenContextFactRepository } from './persistence/kysely-garden-context-fact-repository.js';
export { registerGardenContextRoutes } from './transport/garden-context-routes.js';
export type { GardenContextRoutesDependencies } from './transport/garden-context-routes.js';

// Collaboration: operational invitations and membership administration
// (P9A-API-01). Reuses `GardenAuthorization`, `GardensMappingUnitOfWork`,
// and `MembershipRepository` above — see membership-repository.ts's own
// header for why this module still owns `collaboration.membership` and,
// now, `collaboration.invitation`/`collaboration.membership_period` too.
export type { InvitationRole, InvitationState, Invitation } from './domain/invitation.js';
export { CreateInvitation, INVITATION_TTL_MILLISECONDS } from './application/create-invitation.js';
export { RevokeInvitation } from './application/revoke-invitation.js';
export { AcceptInvitation } from './application/accept-invitation.js';
export type { AcceptInvitationActor } from './application/accept-invitation.js';
export { ListGardenMembers } from './application/list-garden-members.js';
export { ListGardenInvitations } from './application/list-garden-invitations.js';
export { ChangeMemberRole } from './application/change-member-role.js';
export { RemoveMember } from './application/remove-member.js';
export {
  RunInvitationExpirySweep,
  INVITATION_EXPIRY_SWEEP_LIMIT,
} from './application/run-invitation-expiry-sweep.js';
export type { InvitationExpirySweepResult } from './application/run-invitation-expiry-sweep.js';
export type { InvitationRepository } from './application/invitation-repository.js';
export { KyselyInvitationRepository } from './persistence/kysely-invitation-repository.js';
export { registerInvitationRoutes } from './transport/invitation-routes.js';
export type { InvitationRoutesDependencies } from './transport/invitation-routes.js';
export { registerMemberRoutes } from './transport/member-routes.js';
export type { MemberRoutesDependencies } from './transport/member-routes.js';
export { registerInvitationExpirySweepRoute } from './transport/invitation-expiry-sweep-route.js';
export type { InvitationExpirySweepRouteDependencies } from './transport/invitation-expiry-sweep-route.js';

// Owner administration: promote to co-owner, demote an owner, request an
// ownership transfer, accept or decline it as its recipient, or cancel it as
// its initiator (P9A-OWNER-01). Reuses
// `GardenAuthorization`/`GardensMappingUnitOfWork`/`MembershipRepository`
// above, the same posture the rest of Collaboration already takes.
export type {
  OwnershipAdministrationActor,
  OwnershipTransfer,
  OwnershipTransferResultingRole,
  OwnershipTransferState,
} from './domain/ownership-transfer.js';
export {
  OWNERSHIP_ADMINISTRATION_RECENT_AUTHENTICATION_MAX_AGE_MS,
  assertRecentAuthenticationForOwnershipAdministration,
} from './domain/ownership-transfer.js';
export { PromoteToOwner } from './application/promote-to-owner.js';
export { DemoteOwner } from './application/demote-owner.js';
export { TransferOwnership } from './application/transfer-ownership.js';
export { AcceptOwnershipTransfer } from './application/accept-ownership-transfer.js';
export type { OwnershipTransferAcceptActor } from './application/accept-ownership-transfer.js';
export { DeclineOwnershipTransfer } from './application/decline-ownership-transfer.js';
export type { OwnershipTransferDeclineActor } from './application/decline-ownership-transfer.js';
export { CancelOwnershipTransfer } from './application/cancel-ownership-transfer.js';
export type {
  IncomingOwnershipTransfer,
  OwnershipTransferRepository,
} from './application/ownership-transfer-repository.js';
export { KyselyOwnershipTransferRepository } from './persistence/kysely-ownership-transfer-repository.js';
// P9A-OWNER-02 — the garden-scoped and profile-scoped ownership-transfer reads.
export { GetGardenOwnershipTransfer } from './application/get-garden-ownership-transfer.js';
export { ListIncomingOwnershipTransfers } from './application/list-incoming-ownership-transfers.js';
export { registerOwnershipRoutes } from './transport/ownership-routes.js';
export type { OwnershipRoutesDependencies } from './transport/ownership-routes.js';
