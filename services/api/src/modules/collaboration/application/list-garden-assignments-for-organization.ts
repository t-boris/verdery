/**
 * Lists an organization's active garden assignments (P9B-API-01) — "which
 * gardens can this organization's members reach." Any ACTIVE member may read
 * this, the same "any role may see who else can see their own resource"
 * reasoning `ListOrganizationMembers` already applies.
 */

import type { GardenAssignmentListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenAssignmentRepository } from './garden-assignment-repository.js';
import { toGardenAssignmentResource } from './garden-assignment-view.js';
import type { OrganizationAuthorization } from './organization-authorization.js';

export class ListGardenAssignmentsForOrganization {
  constructor(
    private readonly assignments: GardenAssignmentRepository,
    private readonly authorization: OrganizationAuthorization,
  ) {}

  async execute(organizationId: Uuid, profileId: Uuid): Promise<GardenAssignmentListResult> {
    await this.authorization.requireActiveMembership(organizationId, profileId);

    const items = await this.assignments.listActiveForOrganization(organizationId);

    return { items: items.map(toGardenAssignmentResource) };
  }
}
