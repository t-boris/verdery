/**
 * `GET /client/gardens` (P9C-API-01) — every engagement the AUTHENTICATED
 * caller currently holds an ACTIVE `client_access_grant` on, resolved
 * ENTIRELY from the caller's own profile id. No path parameter names an
 * engagement, garden, or organization: this is the one client-portal
 * operation with literally nothing for a caller to enumerate, and it is
 * also where every OTHER client-portal operation's `clientGardenId` comes
 * from.
 *
 * WHY `clientGardenId` IS `client_engagement.id`, NOT A SEPARATE MINTED
 * TOKEN. Section 13's own sentence — "A client-facing garden handle may map
 * internally to an engagement and garden, but authorization always starts
 * from the current client profile and active access grant" — describes a
 * BEHAVIORAL requirement (never trust the handle as authority), not a
 * requirement that the handle's own bytes be unguessable or decorrelated
 * from the engagement id. Every other client-portal read
 * (`ClientPortalAuthorization.requireActiveGardenAccess`) re-derives
 * authorization from the caller's own active grant on every call, so an
 * attacker who already knows or guesses a real `client_engagement.id`
 * gains nothing: they still need an ACTIVE grant on that exact engagement,
 * which only the real client holds. Minting a second, opaque identifier
 * mapped 1:1 to the engagement would add a table, a migration, and a
 * lookup with zero additional security property — the "no new dependencies"
 * constraint this package's own instructions set, applied to schema as well
 * as `package.json`.
 *
 * SKIPS A GRANT WHOSE OWN ENGAGEMENT HAS ENDED OR BEEN REVOKED. Neither
 * `EndClientEngagement` nor `RevokeClientEngagement` (P9B-API-01) touches
 * `client_access_grant` — confirmed by reading both commands — so a grant
 * can still read `state = 'active'` after its engagement is no longer
 * `active`. Silently dropping such an entry here (rather than surfacing a
 * stale garden the client can no longer meaningfully act on) mirrors
 * `ClientPortalAuthorization`'s own "both checks, not just the grant"
 * requirement, applied to a LIST rather than a single lookup — there is no
 * caller-visible error to raise for a list, so the item is simply absent.
 *
 * N+1 READS, DELIBERATELY. A client profile has, in the overwhelming
 * majority of cases, one or a small handful of active engagements — the
 * same low-cardinality assumption `ListClientUpdatesForEngagement`'s own
 * `Promise.all` per-update item read already makes. A dedicated joined
 * query across `client_access_grant`/`client_engagement`/
 * `gardens_mapping.garden` would save round trips at the cost of a third
 * cross-module read port for a volume where it is not worth the added
 * surface.
 *
 * Source: implementation-plan.md work package P9C-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "13. API Surfaces".
 */

import type { ClientGardenListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRepository } from '../../gardens-mapping/public.js';
import type { ClientAccessGrantRepository } from './client-access-grant-repository.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { toClientGardenResource } from './client-portal-view.js';

export class ListClientGardens {
  constructor(
    private readonly grants: ClientAccessGrantRepository,
    private readonly engagements: ClientEngagementRepository,
    private readonly gardens: GardenRepository,
  ) {}

  async execute(clientProfileId: Uuid): Promise<ClientGardenListResult> {
    const activeGrants = await this.grants.listActiveForProfile(clientProfileId);

    const items = [];
    for (const grant of activeGrants) {
      const engagement = await this.engagements.findById(grant.engagementId);
      if (engagement === null || engagement.state !== 'active') {
        continue;
      }

      const garden = await this.gardens.findById(engagement.gardenId);
      if (garden === null) {
        continue;
      }

      items.push(toClientGardenResource(engagement, garden));
    }

    return { items };
  }
}
