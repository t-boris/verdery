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

  /**
   * The export/handoff variant (P9C-EXPORT-01): admits an ENDED engagement
   * in addition to an ACTIVE one — everything else is IDENTICAL to
   * `requireActiveGardenAccess` (the same grant check, the same concealed
   * `clientGardenNotFoundError()` for every failure mode, never a
   * distinguishable answer).
   *
   * WHY `ended` IS ADMITTED. Section 18's engagement-end sequence requires
   * step 2, "Produces or offers the entitled export/handoff package," to
   * remain possible AFTER step 1, "Stops new client publication and access,"
   * has already taken effect — `EndClientEngagement` (P9B-API-01) transitions
   * `client_engagement.state` to `ended` as its ONLY effect (confirmed by
   * reading that command), so admitting `ended` here is exactly what makes
   * the handoff package reachable at all once an engagement is over. Nothing
   * about the caller's own `client_access_grant` changes for this method:
   * `EndClientEngagement` never touches `client_access_grant` either (this
   * file's own header, "WHY BOTH CHECKS, NOT JUST THE GRANT"), so the grant
   * must still be genuinely `active` — this method relaxes the ENGAGEMENT
   * check only, never the grant check.
   *
   * WHY `revoked` IS NOT ADMITTED. Section 8's diagram reaches `revoked` from
   * an adversarial or mistaken cancellation (fraud, wrong client, wrong
   * garden), never from a completed engagement — the blanket rule "an ended
   * OR revoked engagement cannot authorize new portal or media access"
   * (section 8) still governs a revoked one; section 18's handoff promise is
   * for a natural end, not a revocation. A garden owner who revokes an
   * engagement by mistake can create a NEW one and issue a fresh invitation;
   * nothing in the architecture asks a revoked relationship to keep handing
   * out data afterward.
   *
   * Source: architecture/collaboration-and-client-sharing.md, sections
   * "8. Client Engagement", "18. Data Stewardship, Export, and Engagement
   * End"; implementation-plan.md work package P9C-EXPORT-01.
   */
  async requireExportableGardenAccess(
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
    if (engagement === null || (engagement.state !== 'active' && engagement.state !== 'ended')) {
      throw clientGardenNotFoundError();
    }

    return engagement;
  }
}
