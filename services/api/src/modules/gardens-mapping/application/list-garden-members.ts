/**
 * Lists a garden's active member roster (P9A-API-01).
 *
 * `viewGarden` — every role may read this (garden-capability-matrix.md, row
 * H2, decision S1): a household member who cannot see who else can see
 * their garden has less visibility into their own garden than a stranger
 * would. Entries carry only `profileId` and `role`; email addresses are the
 * invitation-binding and enumeration surface and stay owner-visible only on
 * the invitation itself (matrix section 5.5).
 *
 * A pure read, not wrapped in the transactional unit of work — the same
 * "read paths use the pooled connection directly" posture `GetGarden` and
 * every other query in this module already take.
 */

import type { GardenMemberListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAuthorization } from './garden-authorization.js';
import { toGardenMemberResource } from './membership-view.js';
import type { MembershipRepository } from './membership-repository.js';

export class ListGardenMembers {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, actorProfileId: Uuid): Promise<GardenMemberListResult> {
    await this.authorization.requireCapability(gardenId, actorProfileId, 'viewGarden');

    const members = await this.memberships.listActiveForGarden(gardenId);

    return { items: members.map(toGardenMemberResource) };
  }
}
