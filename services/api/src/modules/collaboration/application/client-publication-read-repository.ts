/**
 * The client portal's own read port onto the eight immutable publication
 * tables `PublicationRepository`/`KyselyPublicationRepository` write
 * (P9C-PUBLISH-01) — a SEPARATE, read-only port rather than new methods on
 * `PublicationRepository` itself, because that interface's own header
 * scopes it deliberately narrowly: "Steps 3 and 4 of the six-step publish
 * transaction." Reuses that file's own `PublicationVersionDetail`/
 * `PublicationItemDetail`/`PublicationStaffAttributionDetail` types
 * unchanged — the client portal projects EXISTING immutable rows into a
 * more restricted client-facing shape (`client-portal-view.ts`'s own job);
 * it does not need, and must not invent, a second parallel detail shape for
 * the exact same rows.
 *
 * ONE METHOD SERVES THREE COMMANDS. `GetClientGardenOverview`,
 * `ListClientPublications`, and `GetClientTimeline` all read the identical
 * "every publication_version whose client_update reached exactly
 * `published`" set for one engagement; they differ only in how they then
 * shape/group/order it in the application layer (grouped by version versus
 * flattened by `occurredAt`, and picking the single latest `garden_snapshot`
 * item for the overview). A second, bespoke SQL shape per command would
 * duplicate this same join three times for what is, in practice, a very
 * small per-engagement row count.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { PublicationVersionDetail } from './publication-repository.js';

export interface ClientPublicationReadRepository {
  /**
   * Every `publication_version` for this engagement whose OWNING
   * `client_update` is currently `state = 'published'` — the identical
   * join `KyselyClientMediaEntitlementSource` already establishes as "is
   * this publication visible" (a `client_update` that is `internal_draft`,
   * `ready_for_client`, or `withdrawn` never contributes a version here,
   * even though its `publication_version` row still physically exists for
   * `withdrawn`'s own audit-trail reason) — newest-published first, each
   * with its full items and staff attributions, items ordered by their own
   * `occurredAt` ascending within the version.
   */
  listVisibleForEngagement(engagementId: Uuid): Promise<readonly PublicationVersionDetail[]>;
}
