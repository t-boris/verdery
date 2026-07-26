/**
 * Lists the caller's own service organizations (P9B-API-01) — the
 * organization-scoped mirror of `gardens-mapping/application/
 * list-gardens.ts`'s `ListGardens`. A pure read, not wrapped in the
 * transactional unit of work, the same "read paths use the pooled
 * connection directly" posture every query in this codebase already takes.
 */

import type { ServiceOrganizationListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OrganizationRepository } from './organization-repository.js';
import { toServiceOrganizationResource } from './organization-view.js';

export class ListOrganizations {
  constructor(private readonly organizations: OrganizationRepository) {}

  async execute(profileId: Uuid): Promise<ServiceOrganizationListResult> {
    const items = await this.organizations.listForProfile(profileId);

    return {
      items: items.map((organization) =>
        toServiceOrganizationResource(organization, organization.callerRole),
      ),
    };
  }
}
