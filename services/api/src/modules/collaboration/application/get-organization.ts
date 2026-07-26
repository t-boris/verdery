/**
 * Reads one service organization (P9B-API-01) — the organization-scoped
 * mirror of `gardens-mapping/application/get-garden.ts`'s `GetGarden`.
 *
 * `requireActiveMembership`, not `requireCapability`: any ACTIVE member may
 * read the organization's own identity, `organizationAdmin` and
 * `professional` alike — there is no capability gate on a plain read.
 */

import type { ServiceOrganization as ServiceOrganizationResource } from '@verdery/api-contracts';
import { OrganizationErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import type { OrganizationRepository } from './organization-repository.js';
import { toServiceOrganizationResource } from './organization-view.js';

export class GetOrganization {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly authorization: OrganizationAuthorization,
  ) {}

  async execute(organizationId: Uuid, profileId: Uuid): Promise<ServiceOrganizationResource> {
    const membership = await this.authorization.requireActiveMembership(organizationId, profileId);

    const organization = await this.organizations.findById(organizationId);
    if (organization === null) {
      // The membership row referenced an organization that no longer
      // exists — unreachable today (nothing deletes a `service_organization`
      // row; see `domain/service-organization.ts`'s own header), but a
      // concealed-existence 404 is still the correct response if it ever
      // happened, not a 500 — the same posture `GetGarden` takes for the
      // identical unreachable case.
      throw new NotFoundError(OrganizationErrorCode.NotFound, 'Organization not found.');
    }

    return toServiceOrganizationResource(organization, membership.role);
  }
}
