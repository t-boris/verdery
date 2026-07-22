/**
 * Capability evaluation for garden access.
 *
 * A profile with no membership on the garden and a profile whose membership
 * lacks the required capability both fail, but must not look the same to an
 * attacker probing for which garden IDs exist: the former conceals existence
 * as `notFound`, the latter is a `forbidden` a member already knows applies
 * to a garden they know exists.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "9. Authorization Evaluation"; implementation-plan.md work package P2-SEC-01.
 */

import { GardenErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import { ForbiddenError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenCapability } from '../domain/garden-role.js';
import { roleHasCapability } from '../domain/garden-role.js';
import type { Membership, MembershipRepository } from './membership-repository.js';

export class GardenAuthorization {
  constructor(private readonly memberships: MembershipRepository) {}

  /** Returns the caller's membership, or throws `notFound`/`forbidden` per the concealment rule above. */
  async requireCapability(
    gardenId: Uuid,
    profileId: Uuid,
    capability: GardenCapability,
  ): Promise<Membership> {
    const membership = await this.memberships.findActiveMembership(gardenId, profileId);

    if (membership === null) {
      throw new NotFoundError(GardenErrorCode.NotFound, 'Garden not found.');
    }

    if (!roleHasCapability(membership.role, capability)) {
      throw new ForbiddenError(
        SharedErrorCode.Forbidden,
        'You do not have permission to perform this action on this garden.',
      );
    }

    return membership;
  }
}
