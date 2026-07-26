/**
 * Lists an organization's active membership roster (P9B-API-01).
 *
 * Any ACTIVE member may read this — `organizationAdmin` and `professional`
 * alike, the same "any role may see who else can see their own resource"
 * reasoning `gardens-mapping/application/list-garden-members.ts`'s
 * `ListGardenMembers` already applies to a garden's own roster.
 */

import type { OrganizationMemberListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import type { OrganizationMembershipRepository } from './organization-membership-repository.js';
import { toOrganizationMemberResource } from './organization-view.js';

export class ListOrganizationMembers {
  constructor(
    private readonly memberships: OrganizationMembershipRepository,
    private readonly authorization: OrganizationAuthorization,
  ) {}

  async execute(organizationId: Uuid, profileId: Uuid): Promise<OrganizationMemberListResult> {
    await this.authorization.requireActiveMembership(organizationId, profileId);

    const members = await this.memberships.listActiveForOrganization(organizationId);

    return { items: members.map(toOrganizationMemberResource) };
  }
}
