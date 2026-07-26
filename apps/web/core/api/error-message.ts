import {
  CollaborationErrorCode,
  GardenErrorCode,
  MapErrorCode,
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
  [CollaborationErrorCode.TargetNotOwner]: 'error.targetNotOwner',
  [CollaborationErrorCode.TargetAlreadyOwner]: 'error.targetAlreadyOwner',
  [CollaborationErrorCode.OwnershipTransferAlreadyPending]: 'error.ownershipTransferAlreadyPending',
  [CollaborationErrorCode.OwnershipTransferNotFound]: 'error.ownershipTransferNotFound',
};

/** Returns the message identifier for an error code, or the generic one. */
export function errorMessageKey(code: string): MessageKey {
  return MESSAGE_KEYS[code] ?? 'error.unknown';
}
