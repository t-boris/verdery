/**
 * Maps a domain `Invitation` to the contract shape — the same
 * "application code returns the contract-shaped view" rule `garden-view.ts`
 * documents.
 */

import type {
  CreateInvitationResult,
  Invitation as InvitationResource,
} from '@verdery/api-contracts';
import type { Invitation } from '../domain/invitation.js';

export function toInvitationResource(invitation: Invitation): InvitationResource {
  const resource: InvitationResource = {
    id: invitation.id,
    gardenId: invitation.gardenId,
    inviterProfileId: invitation.inviterProfileId,
    intendedRole: invitation.intendedRole,
    state: invitation.state,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };

  // Assigned rather than conditionally spread so `exactOptionalPropertyTypes`
  // can see each key is only ever present with a real value — the same
  // posture `toGardenResource` already takes for `recoveryDeadlineAt`.
  if (invitation.intendedEmail !== null) {
    resource.intendedEmail = invitation.intendedEmail;
  }
  if (invitation.acceptedAt !== null) {
    resource.acceptedAt = invitation.acceptedAt.toISOString();
  }
  if (invitation.revokedAt !== null) {
    resource.revokedAt = invitation.revokedAt.toISOString();
  }
  if (invitation.resultingMembershipId !== null) {
    resource.resultingMembershipId = invitation.resultingMembershipId;
  }

  return resource;
}

/**
 * The ONE response that also carries the raw token — see
 * `application/invitation-token.ts`'s header for why it is never
 * recoverable again after this.
 */
export function toCreateInvitationResult(
  invitation: Invitation,
  token: string,
): CreateInvitationResult {
  return { ...toInvitationResource(invitation), token };
}
