/**
 * Maps a `ClientEngagementDetail` to the exact `ClientEngagement` contract
 * shape — the same "application code returns the contract-shaped view" rule
 * `organization-view.ts` documents.
 */

import type { ClientEngagement } from '@verdery/api-contracts';
import type { ClientEngagementDetail } from './client-engagement-repository.js';

export function toClientEngagementResource(engagement: ClientEngagementDetail): ClientEngagement {
  const resource: ClientEngagement = {
    id: engagement.id,
    gardenId: engagement.gardenId,
    state: engagement.state,
    stewardshipPolicy: engagement.stewardshipPolicy,
    clientNotificationsEnabled: engagement.clientNotificationsEnabled,
    createdByProfileId: engagement.createdByProfileId,
    createdAt: engagement.createdAt.toISOString(),
    updatedAt: engagement.updatedAt.toISOString(),
  };

  // Assigned rather than conditionally spread — see `toGardenAssignmentResource`'s own comment for why.
  if (engagement.serviceOrganizationId !== null) {
    resource.serviceOrganizationId = engagement.serviceOrganizationId;
  }
  if (engagement.activatedAt !== null) {
    resource.activatedAt = engagement.activatedAt.toISOString();
  }
  if (engagement.endedAt !== null) {
    resource.endedAt = engagement.endedAt.toISOString();
  }
  if (engagement.revokedAt !== null) {
    resource.revokedAt = engagement.revokedAt.toISOString();
  }
  if (engagement.revokedReason !== null) {
    resource.revokedReason = engagement.revokedReason;
  }

  return resource;
}
