/**
 * Narrow, read-only port into FIVE tables `collaboration` owns
 * (`client_access_grant`, `client_engagement`, `client_update`,
 * `publication_version`, `media_entitlement`) — the
 * `GardenAssignmentAccessSource`/`KyselyGardenAssignmentAccessSource`
 * cross-module-read-port precedent (see that port's own header in
 * `modules/gardens-mapping/application/garden-assignment-access-source.ts`),
 * applied in the OPPOSITE direction: there, `gardens-mapping` reads a table
 * `collaboration` owns because garden-scoped authorization needs it; here,
 * `media` reads `collaboration`'s own client-publication tables because
 * CLIENT media authorization needs them, and `media` alone owns the
 * byte-delivery mechanism (`MediaRepository`, `MediaStorageGateway`) that
 * authorization gates in front of — the same module-boundary reasoning as
 * `GetMediaAccess` already depending on `gardens-mapping`'s own
 * `GardenAuthorization` for the OPERATIONAL case. Never imports
 * `collaboration`'s own repository classes — only this port, implemented by
 * a Kysely adapter that reads the shared typed schema directly, the "narrow
 * read port, not a second copy of someone else's repository" boundary rule
 * `docs/architecture/backend-modular-monolith.md` section "5.3 Persistence"
 * states.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "16. Media Access"; implementation-plan.md work package P9C-MEDIA-01.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientEngagementState, PublicationState } from '../../collaboration/public.js';

/**
 * `collaboration.client_access_grant.state`'s own vocabulary
 * (`client_access_grant_state_check`). No dedicated domain file exists yet
 * for this state machine in `collaboration/domain` (P9C-INVITE-01's own
 * scope, per the work-package table, is where its transitions would be
 * formalized) — kept as a plain literal union here rather than inventing
 * one, the same "do not add unrequested machinery" discipline this
 * session's own migrations already document elsewhere.
 */
export type ClientAccessGrantState = 'pending' | 'active' | 'revoked';

/**
 * The caller's client-side path to ONE exact `media_record_id`: the state
 * of the engagement that entitled it, the state of THIS profile's own
 * access grant on that engagement, and the state of the publication that
 * made it visible — all read together, at one instant, from the row(s) that
 * answer "does this profile have ANY entitlement-linked path to this exact
 * media object" (section 16's own "explicit publication-media
 * entitlement"). `GetClientMediaAccess` evaluates each field in section
 * 16's own listed order, so a denial is traceable to the exact condition
 * that failed even though the read itself is one query — mirroring
 * `GardenAssignmentAccessSource`'s own "read together, at one instant"
 * reasoning.
 */
export interface ClientMediaEntitlementGrant {
  readonly engagementId: Uuid;
  readonly engagementState: ClientEngagementState;
  readonly grantState: ClientAccessGrantState;
  readonly publicationVersionId: Uuid;
  readonly publicationState: PublicationState;
}

export interface ClientMediaEntitlementSource {
  /**
   * `null` when no `media_entitlement` row names this exact
   * `mediaRecordId` under an engagement this `clientProfileId` holds ANY
   * `client_access_grant` row on (active, pending, or revoked — the STATE
   * comparison is `GetClientMediaAccess`'s job, not this port's; a `null`
   * result here means "no such row pair exists at all", covering both
   * "nobody ever entitled this media" and "this profile was never granted
   * access to the engagement that did" identically). Deliberately does not
   * filter by state at all: section 16 requires active engagement, active
   * grant, and visible publication to each be genuinely rechecked, never
   * assumed from row existence alone — see this file's own header.
   */
  findEntitlementGrant(
    clientProfileId: Uuid,
    mediaRecordId: Uuid,
  ): Promise<ClientMediaEntitlementGrant | null>;
}
