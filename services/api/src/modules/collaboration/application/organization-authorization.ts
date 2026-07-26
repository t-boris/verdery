/**
 * Capability evaluation for organization-scoped actions — this module's own
 * application of `gardens-mapping/application/garden-authorization.ts`'s ONE
 * enforcement pattern (role -> capability, existence concealed as
 * `notFound`), applied to `collaboration.organization_membership` instead of
 * `collaboration.membership`.
 *
 * ONLY TWO QUESTIONS HERE, NOT THREE. `GardenAuthorization.requireCapability`
 * asks a third question — "is the resource in a lifecycle state where this
 * capability applies?" — because `gardens_mapping.garden` has a real
 * lifecycle. `collaboration.service_organization` has none (see
 * `domain/service-organization.ts`'s own header and `domain/
 * organization-role.ts`'s "ONLY ONE MATRIX HERE" comment), so there is no
 * third question to ask yet. A future organization lifecycle would earn a
 * third step here the same way the garden one earned its own.
 *
 * TWO METHODS, NOT ONE, because organization capabilities are not universal
 * the way `viewGarden` is. `garden-role.ts` gives every `GardenRole` at least
 * `viewGarden`, so `GardenAuthorization.requireCapability(id, profile,
 * 'viewGarden')` doubles as "does the caller have ANY visibility into this
 * resource" for read paths. `organization-role.ts` gives `professional` an
 * EMPTY capability set — there is no capability every `OrganizationRole`
 * shares, so no single `requireCapability` call could serve as a universal
 * membership check. `requireActiveMembership` is that universal check,
 * kept deliberately separate from — and always run by — `requireCapability`.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "9. Authorization Evaluation"; implementation-plan.md work package
 * P9B-API-01.
 */

import { OrganizationErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import { ForbiddenError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OrganizationCapability } from '../domain/organization-role.js';
import { organizationRoleHasCapability } from '../domain/organization-role.js';
import type {
  OrganizationMembership,
  OrganizationMembershipRepository,
} from './organization-membership-repository.js';

export class OrganizationAuthorization {
  constructor(private readonly memberships: OrganizationMembershipRepository) {}

  /** Returns the caller's ACTIVE membership, or conceals a non-existent organization and a non-member identically as `notFound`. */
  async requireActiveMembership(
    organizationId: Uuid,
    profileId: Uuid,
  ): Promise<OrganizationMembership> {
    const membership = await this.memberships.findActiveByOrganizationAndProfile(
      organizationId,
      profileId,
    );

    if (membership === null) {
      throw new NotFoundError(OrganizationErrorCode.NotFound, 'Organization not found.');
    }

    return membership;
  }

  /** Returns the caller's ACTIVE membership, or throws `notFound`/`forbidden` per the rules above. */
  async requireCapability(
    organizationId: Uuid,
    profileId: Uuid,
    capability: OrganizationCapability,
  ): Promise<OrganizationMembership> {
    const membership = await this.requireActiveMembership(organizationId, profileId);

    if (!organizationRoleHasCapability(membership.role, capability)) {
      throw new ForbiddenError(
        SharedErrorCode.Forbidden,
        'You do not have permission to perform this action on this organization.',
      );
    }

    return membership;
  }
}
