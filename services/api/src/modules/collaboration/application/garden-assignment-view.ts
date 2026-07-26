/**
 * Maps a `GardenAssignmentDetail` to the exact `GardenAssignment` contract
 * shape — the same "application code returns the contract-shaped view" rule
 * `organization-view.ts` documents.
 */

import type { GardenAssignment } from '@verdery/api-contracts';
import type { GardenAssignmentDetail } from './garden-assignment-repository.js';

export function toGardenAssignmentResource(assignment: GardenAssignmentDetail): GardenAssignment {
  const resource: GardenAssignment = {
    id: assignment.id,
    organizationId: assignment.organizationId,
    profileId: assignment.profileId,
    gardenId: assignment.gardenId,
    role: assignment.role,
    state: assignment.state,
    validFrom: assignment.validFrom.toISOString(),
    createdByProfileId: assignment.createdByProfileId,
    createdAt: assignment.createdAt.toISOString(),
  };

  // Assigned rather than conditionally spread so `exactOptionalPropertyTypes`
  // can see the key is only ever present with a real value — the same
  // posture `toGardenResource`'s own `recoveryDeadlineAt` handling takes.
  if (assignment.validUntil !== null) {
    resource.validUntil = assignment.validUntil.toISOString();
  }

  return resource;
}
