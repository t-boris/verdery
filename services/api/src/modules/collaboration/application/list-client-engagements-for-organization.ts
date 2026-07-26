/**
 * Lists an organization's client engagements (P9B-API-01). Any ACTIVE
 * member may read this — the same "any role may see who else can see their
 * own resource" reasoning `ListOrganizationMembers`/
 * `ListGardenAssignmentsForOrganization` already apply. Returns every
 * engagement in any state, newest first.
 */

import type { ClientEngagementListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { toClientEngagementResource } from './client-engagement-view.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import type { OrganizationAuthorization } from './organization-authorization.js';

export class ListClientEngagementsForOrganization {
  constructor(
    private readonly engagements: ClientEngagementRepository,
    private readonly authorization: OrganizationAuthorization,
  ) {}

  async execute(organizationId: Uuid, profileId: Uuid): Promise<ClientEngagementListResult> {
    await this.authorization.requireActiveMembership(organizationId, profileId);

    const items = await this.engagements.listForOrganization(organizationId);

    return { items: items.map(toClientEngagementResource) };
  }
}
