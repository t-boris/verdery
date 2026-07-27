/**
 * The client portal's own authorization resolver (P9C-API-01) — the single
 * place collaboration-and-client-sharing.md section 13's own sentence gets
 * implemented: "Operational identifiers are not accepted as authority by
 * client routes. A client-facing garden handle may map internally to an
 * engagement and garden, but authorization always starts from the current
 * client profile and active access grant."
 *
 * `clientGardenId` IS, concretely, `client_engagement.id` (see
 * `list-client-gardens.ts`'s own header for why reusing that value directly
 * is deliberate, not an oversight), but this class is what makes that safe:
 * every `GetClientGardenOverview`/`ListClientPublications`/`GetClientTimeline`
 * call routes through `requireActiveGardenAccess` FIRST, which re-reads
 * BOTH the caller's own grant state and the engagement's own state fresh —
 * never trusting the path parameter as a bare lookup key the way an
 * operational `engagementId` is trusted elsewhere in this module (compare
 * `client-update-routes.ts`, which resolves entirely from a professional-
 * supplied `engagementId`; that shape is explicitly wrong here, per this
 * package's own instructions).
 *
 * CONCEALS EVERY FAILURE MODE IDENTICALLY. A `clientGardenId` that does not
 * exist at all, one belonging to another client's engagement, one whose
 * grant was revoked, and one whose engagement itself ended or was revoked
 * all raise the exact same `clientGardenNotFoundError()` — this class has
 * no branch that could leak which of those is true, unlike
 * `PublisherAuthorization` (which deliberately throws `forbidden`, not
 * `notFound`, for a caller who already administers the engagement — see
 * that file's own header). A client caller never "already knows the
 * engagement exists" the way a professional administering it does, so
 * there is no legitimate audience here for a distinguishable answer.
 *
 * WHY BOTH CHECKS, NOT JUST THE GRANT. `EndClientEngagement`/
 * `RevokeClientEngagement` (P9B-API-01) never touch `client_access_grant`
 * — confirmed by reading both commands before writing this class — so a
 * grant can read back `state = 'active'` while its OWN engagement has
 * already ended or been revoked. Checking only the grant would let a
 * client keep reading a garden whose engagement is over; checking the
 * engagement's own state here is the identical "active engagement" half of
 * `GetClientMediaAccess`'s own check 2 (media-storage-and-processing.md/
 * collaboration-and-client-sharing.md section 16), reapplied to the portal
 * reads that package's own six-condition list does not otherwise cover.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "13. API Surfaces"; implementation-plan.md work package P9C-API-01.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientAccessGrantRepository } from './client-access-grant-repository.js';
import type {
  ClientEngagementDetail,
  ClientEngagementRepository,
} from './client-engagement-repository.js';
import { clientGardenNotFoundError } from './client-portal-errors.js';

export class ClientPortalAuthorization {
  constructor(
    private readonly grants: ClientAccessGrantRepository,
    private readonly engagements: ClientEngagementRepository,
  ) {}

  /**
   * Resolves `clientGardenId` for THIS caller, or throws the one concealed
   * `clientGardenNotFoundError()` — never a distinguishable `403`. Returns
   * the engagement so callers can read `gardenId` off it without a second
   * lookup.
   */
  async requireActiveGardenAccess(
    clientProfileId: Uuid,
    clientGardenId: Uuid,
  ): Promise<ClientEngagementDetail> {
    const grant = await this.grants.findActiveForProfileAndEngagement(
      clientProfileId,
      clientGardenId,
    );
    if (grant === null) {
      throw clientGardenNotFoundError();
    }

    const engagement = await this.engagements.findById(clientGardenId);
    if (engagement === null || engagement.state !== 'active') {
      throw clientGardenNotFoundError();
    }

    return engagement;
  }
}
