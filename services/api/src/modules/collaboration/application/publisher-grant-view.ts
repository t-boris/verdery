/**
 * Maps a `PublisherGrantDetail` to the exact `PublisherGrant` contract
 * shape — the same "application code returns the contract-shaped view" rule
 * `organization-view.ts` documents.
 */

import type { PublisherGrant } from '@verdery/api-contracts';
import type { PublisherGrantDetail } from './publisher-grant-repository.js';

export function toPublisherGrantResource(grant: PublisherGrantDetail): PublisherGrant {
  const resource: PublisherGrant = {
    id: grant.id,
    engagementId: grant.engagementId,
    profileId: grant.profileId,
    state: grant.state,
    grantedByProfileId: grant.grantedByProfileId,
    grantedAt: grant.grantedAt.toISOString(),
    createdAt: grant.createdAt.toISOString(),
  };

  if (grant.revokedAt !== null) {
    resource.revokedAt = grant.revokedAt.toISOString();
  }
  if (grant.revokedByProfileId !== null) {
    resource.revokedByProfileId = grant.revokedByProfileId;
  }

  return resource;
}
