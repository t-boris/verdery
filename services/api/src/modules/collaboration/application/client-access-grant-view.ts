/**
 * Maps a `ClientAccessGrant` (domain) to the exact `ClientAccessGrant`
 * contract shape — the same "application code returns the contract-shaped
 * view" rule `publisher-grant-view.ts`/`client-engagement-view.ts` already
 * document. Never includes `tokenHash` — the contract schema itself has no
 * such field, matching the operational invitation's own posture of never
 * returning a token's hash, only (once, at creation) its raw form.
 */

import type { ClientAccessGrant as ClientAccessGrantResource } from '@verdery/api-contracts';
import type { ClientAccessGrant } from '../domain/client-access-grant.js';

export function toClientAccessGrantResource(grant: ClientAccessGrant): ClientAccessGrantResource {
  const resource: ClientAccessGrantResource = {
    id: grant.id,
    engagementId: grant.engagementId,
    state: grant.state,
    createdAt: grant.createdAt.toISOString(),
  };

  if (grant.clientProfileId !== null) {
    resource.clientProfileId = grant.clientProfileId;
  }
  if (grant.invitedEmail !== null) {
    resource.invitedEmail = grant.invitedEmail;
  }
  if (grant.grantedAt !== null) {
    resource.grantedAt = grant.grantedAt.toISOString();
  }
  if (grant.revokedAt !== null) {
    resource.revokedAt = grant.revokedAt.toISOString();
  }
  if (grant.expiresAt !== null) {
    resource.expiresAt = grant.expiresAt.toISOString();
  }

  return resource;
}
