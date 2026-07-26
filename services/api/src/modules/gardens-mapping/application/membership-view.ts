/**
 * Maps a domain membership row to the exact `GardenMember` contract shape —
 * the same "application code returns the contract-shaped view" rule
 * `garden-view.ts` documents, so the idempotency store caches the literal
 * response a retried request replays.
 */

import type { GardenMember } from '@verdery/api-contracts';
import type { MembershipDetail } from './membership-repository.js';

export function toGardenMemberResource(membership: MembershipDetail): GardenMember {
  return {
    id: membership.id,
    gardenId: membership.gardenId,
    profileId: membership.profileId,
    role: membership.role,
    state: membership.state,
    createdAt: membership.createdAt.toISOString(),
    updatedAt: membership.updatedAt.toISOString(),
  };
}
