import {
  ClientAccessGrantErrorCode,
  ClientEngagementErrorCode,
  ClientPortalErrorCode,
  ClientUpdateErrorCode,
  CollaborationErrorCode,
  DeletionErrorCode,
  ExportErrorCode,
  MediaErrorCode,
  NotificationErrorCode,
  GardenErrorCode,
  MapErrorCode,
  OrganizationErrorCode,
  PublisherGrantErrorCode,
  SharedErrorCode,
} from '@verdery/api-contracts';

import type { MessageKey } from '@/shared/localization/public';

import { ClientErrorCode } from './result';

/**
 * Message identifier for each error code the shell can encounter.
 *
 * The mapping is explicit rather than derived from the code string, so adding a
 * server code without translating it is a visible omission instead of a silent
 * fallback to English.
 *
 * Source: architecture/api-design.md, section "12. Error Envelope".
 */
const MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  [SharedErrorCode.RequestInvalid]: 'error.requestInvalid',
  [SharedErrorCode.RequestTooLarge]: 'error.requestTooLarge',
  [SharedErrorCode.IdempotencyKeyReused]: 'error.idempotencyKeyReused',
  [SharedErrorCode.Unauthenticated]: 'error.unauthenticated',
  [SharedErrorCode.Forbidden]: 'error.forbidden',
  [SharedErrorCode.StaleRevision]: 'error.staleRevision',
  [SharedErrorCode.RateLimited]: 'error.rateLimited',
  [SharedErrorCode.Internal]: 'error.internal',
  [SharedErrorCode.DependencyUnavailable]: 'error.dependencyUnavailable',
  [ClientErrorCode.TransportFailure]: 'error.transportFailure',
  [ClientErrorCode.MalformedResponse]: 'error.malformedResponse',
  [GardenErrorCode.NotFound]: 'error.gardenNotFound',
  [GardenErrorCode.StaleRevision]: 'error.gardenStaleRevision',
  [GardenErrorCode.LifecycleConflict]: 'error.gardenLifecycleConflict',
  [MapErrorCode.NotFound]: 'error.mapObjectNotFound',
  [MapErrorCode.StaleRevision]: 'error.mapObjectStaleRevision',
  [MapErrorCode.LifecycleConflict]: 'error.mapObjectLifecycleConflict',
  'map.plan_page_not_ready': 'error.planPageNotReady',
  'map.plat_reading_unavailable': 'error.platReadingUnavailable',
  'map.plat_reading_failed': 'error.platReadingFailed',
  'map.aerial_tracing_unavailable': 'error.aerialTracingUnavailable',
  'map.aerial_tracing_needs_location': 'error.aerialTracingNeedsLocation',
  'map.aerial_tracing_failed': 'error.aerialTracingFailed',
  'map.aerial_tracing_needs_lot': 'error.aerialTracingNeedsLot',
  'map.aerial_tracing_lot_too_large': 'error.aerialTracingLotTooLarge',
  'plants_inventory.plant_candidate.identification_source_not_ready':
    'error.candidateIdentificationSourceNotReady',
  'plants_inventory.plant_candidate.identification_photo_missing':
    'error.candidateIdentificationPhotoMissing',
  'plants_inventory.plant_candidate.identification_no_confident_match':
    'error.candidateIdentificationNoConfidentMatch',
  'plants_inventory.plant.identification_source_not_ready':
    'error.candidateIdentificationSourceNotReady',
  [CollaborationErrorCode.MembershipNotFound]: 'error.membershipNotFound',
  [CollaborationErrorCode.LastOwnerRequired]: 'error.lastOwnerRequired',
  [CollaborationErrorCode.OwnerRoleNotAllowed]: 'error.ownerRoleNotAllowed',
  [CollaborationErrorCode.InvitationNotFound]: 'error.invitationNotFound',
  [CollaborationErrorCode.InvitationAlreadyPending]: 'error.invitationAlreadyPending',
  [CollaborationErrorCode.InvitationExpired]: 'error.invitationExpired',
  [CollaborationErrorCode.InvitationRevoked]: 'error.invitationRevoked',
  [CollaborationErrorCode.InvitationAlreadyAccepted]: 'error.invitationAlreadyAccepted',
  [CollaborationErrorCode.InvitationEmailMismatch]: 'error.invitationEmailMismatch',
  [CollaborationErrorCode.RecentAuthenticationRequired]:
    'error.collaborationRecentAuthenticationRequired',
  // Garden deletion and its recovery. Unmapped until 2026-08-03, so
  // requesting a deletion with an older session showed "the request failed
  // for an unrecognized reason" — hiding an answer the server had already
  // given in plain words, and one the reader can act on.
  [DeletionErrorCode.RecentAuthenticationRequired]: 'error.deletionRecentAuthenticationRequired',
  [DeletionErrorCode.NotFound]: 'error.deletionNotFound',
  [DeletionErrorCode.AlreadyRequested]: 'error.deletionAlreadyRequested',
  [DeletionErrorCode.NotRecoverable]: 'error.deletionNotRecoverable',
  // Media, notifications and exports were unmapped for the same reason:
  // nothing failed when a code arrived without a translation.
  [MediaErrorCode.NotFound]: 'error.mediaNotFound',
  [MediaErrorCode.StaleRevision]: 'error.mediaStaleRevision',
  [MediaErrorCode.UploadStateConflict]: 'error.mediaUploadStateConflict',
  [MediaErrorCode.NotAvailable]: 'error.mediaNotAvailable',
  [MediaErrorCode.ViewerAccessRestricted]: 'error.mediaViewerAccessRestricted',
  [MediaErrorCode.ProcessingJobNotFound]: 'error.mediaProcessingJobNotFound',
  [MediaErrorCode.Referenced]: 'error.mediaReferenced',
  [MediaErrorCode.DerivativeNotDeletable]: 'error.mediaDerivativeNotDeletable',
  [NotificationErrorCode.NotFound]: 'error.notificationNotFound',
  [NotificationErrorCode.PreferencesStaleRevision]: 'error.notificationPreferencesStaleRevision',
  [ExportErrorCode.NotFound]: 'error.exportNotFound',
  [ExportErrorCode.ActiveExportExists]: 'error.exportActiveExportExists',
  [ExportErrorCode.RecentAuthenticationRequired]: 'error.exportRecentAuthenticationRequired',
  [ExportErrorCode.NotDownloadable]: 'error.exportNotDownloadable',
  [CollaborationErrorCode.TargetNotOwner]: 'error.targetNotOwner',
  [CollaborationErrorCode.TargetAlreadyOwner]: 'error.targetAlreadyOwner',
  [CollaborationErrorCode.OwnershipTransferAlreadyPending]: 'error.ownershipTransferAlreadyPending',
  [CollaborationErrorCode.OwnershipTransferNotFound]: 'error.ownershipTransferNotFound',
  [OrganizationErrorCode.NotFound]: 'error.organizationNotFound',
  [OrganizationErrorCode.ProfileNotFound]: 'error.organizationProfileNotFound',
  [OrganizationErrorCode.MembershipNotFound]: 'error.organizationMembershipNotFound',
  [OrganizationErrorCode.MembershipAlreadyExists]: 'error.organizationMembershipAlreadyExists',
  [OrganizationErrorCode.LastAdminRequired]: 'error.organizationLastAdminRequired',
  [OrganizationErrorCode.AssignmentNotFound]: 'error.gardenAssignmentNotFound',
  [OrganizationErrorCode.AssignmentAlreadyActive]: 'error.gardenAssignmentAlreadyActive',
  [OrganizationErrorCode.AssigneeNotOrganizationMember]: 'error.gardenAssignmentAssigneeNotMember',
  [OrganizationErrorCode.AssignmentInvalidTransition]: 'error.gardenAssignmentInvalidTransition',
  [ClientEngagementErrorCode.NotFound]: 'error.clientEngagementNotFound',
  [ClientEngagementErrorCode.InvalidTransition]: 'error.clientEngagementInvalidTransition',
  [ClientAccessGrantErrorCode.NotFound]: 'error.clientAccessGrantNotFound',
  [ClientAccessGrantErrorCode.AlreadyOutstanding]: 'error.clientAccessGrantAlreadyOutstanding',
  [ClientAccessGrantErrorCode.Expired]: 'error.clientAccessGrantExpired',
  [ClientAccessGrantErrorCode.Revoked]: 'error.clientAccessGrantRevoked',
  [ClientAccessGrantErrorCode.AlreadyAccepted]: 'error.clientAccessGrantAlreadyAccepted',
  [ClientAccessGrantErrorCode.EmailMismatch]: 'error.clientAccessGrantEmailMismatch',
  [ClientAccessGrantErrorCode.EngagementNotInvitable]:
    'error.clientAccessGrantEngagementNotInvitable',
  [ClientAccessGrantErrorCode.EngagementNotActive]: 'error.clientAccessGrantEngagementNotActive',
  [ClientAccessGrantErrorCode.InvalidTransition]: 'error.clientAccessGrantInvalidTransition',
  [ClientPortalErrorCode.NotFound]: 'error.clientGardenNotFound',
  [ClientUpdateErrorCode.NotFound]: 'error.clientUpdateNotFound',
  [ClientUpdateErrorCode.PublisherAccessRequired]: 'error.clientUpdatePublisherAccessRequired',
  [ClientUpdateErrorCode.EngagementNotActive]: 'error.clientUpdateEngagementNotActive',
  [ClientUpdateErrorCode.InvalidTransition]: 'error.clientUpdateInvalidTransition',
  [ClientUpdateErrorCode.SummaryRequired]: 'error.clientUpdateSummaryRequired',
  [ClientUpdateErrorCode.ItemNotFound]: 'error.clientUpdateItemNotFound',
  [ClientUpdateErrorCode.SelectedItemInvalid]: 'error.clientUpdateSelectedItemInvalid',
  [ClientUpdateErrorCode.StaffProfileNotFound]: 'error.clientUpdateStaffProfileNotFound',
  [ClientUpdateErrorCode.StaleRevision]: 'error.clientUpdateStaleRevision',
  [PublisherGrantErrorCode.NotFound]: 'error.publisherGrantNotFound',
  [PublisherGrantErrorCode.AlreadyActive]: 'error.publisherGrantAlreadyActive',
  [PublisherGrantErrorCode.GranteeNotOrganizationMember]:
    'error.publisherGrantGranteeNotOrganizationMember',
  [PublisherGrantErrorCode.GranteeNotGardenMember]: 'error.publisherGrantGranteeNotGardenMember',
};

/** Returns the message identifier for an error code, or the generic one. */
export function errorMessageKey(code: string): MessageKey {
  return MESSAGE_KEYS[code] ?? 'error.unknown';
}
