/**
 * Capability evaluation for the SEPARATE publisher capability
 * (P9C-PUBLISH-01) — ADR-0012, "Publication Boundary": "Owner, editor, or
 * professional status alone does not grant publication access." Every
 * client-update lifecycle command funnels through this one check, never
 * through `OrganizationAuthorization.requireCapability('manageEngagement')`
 * or `GardenAuthorization.requireCapability('manageGarden')` — those two
 * gate WHO MAY GRANT the capability (see `require-engagement-capability.ts`,
 * reused unchanged by `GrantPublisherAccess`/`RevokePublisherAccess`), never
 * who may exercise it.
 *
 * ONE QUESTION HERE, NOT TWO, UNLIKE `OrganizationAuthorization`. There is
 * only one publisher capability (not a role matrix), and `publisher_grant`
 * carries no resource lifecycle of its own to evaluate against — the
 * identical "no third question to ask yet" reasoning
 * `OrganizationAuthorization`'s own header already gives for
 * `service_organization`.
 *
 * DOES NOT CHECK ENGAGEMENT EXISTENCE. Every caller of this class already
 * looked up the engagement first (to learn its `gardenId`/
 * `serviceOrganizationId`, or simply to decide `404` versus `403`) — see
 * `CreateClientUpdate`'s own header for why that ordering matters here: an
 * actor who legitimately administers the engagement (an org admin, a garden
 * owner) but holds no publisher grant must see `403`, not `404` — they
 * already know the engagement exists, often because they created it.
 * Concealing existence from THEM would be nonsensical. A genuinely
 * unrelated caller instead fails the engagement lookup itself with `404`,
 * before this class is ever consulted.
 *
 * Source: architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Publication Boundary".
 */

import { ClientUpdateErrorCode } from '@verdery/api-contracts';
import { ForbiddenError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  PublisherGrantDetail,
  PublisherGrantRepository,
} from './publisher-grant-repository.js';

export class PublisherAuthorization {
  constructor(private readonly grants: PublisherGrantRepository) {}

  /** Returns the caller's ACTIVE publisher grant, or throws `forbidden` (never `notFound` — see this file's own header). */
  async requireActiveGrant(engagementId: Uuid, profileId: Uuid): Promise<PublisherGrantDetail> {
    const grant = await this.grants.findActiveByEngagementAndProfile(engagementId, profileId);

    if (grant === null) {
      throw new ForbiddenError(
        ClientUpdateErrorCode.PublisherAccessRequired,
        'You do not have publisher access on this engagement.',
      );
    }

    return grant;
  }
}
