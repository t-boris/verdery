/**
 * `GET /client/gardens/{clientGardenId}/publications` (P9C-API-01) — every
 * VISIBLE (`client_update.state = 'published'`) `publication_version` for
 * this engagement, newest-published first, each with its client-safe
 * title/summary and item snapshots grouped under that one version.
 *
 * WITHDRAWN NEVER APPEARS. `ClientPublicationReadRepository
 * .listVisibleForEngagement` joins on the exact same `client_update.state =
 * 'published'` condition `KyselyClientMediaEntitlementSource` already
 * established as "is this publication visible" — reused unchanged, not
 * re-derived, per this package's own instructions.
 *
 * ORDER: NEWEST FIRST. Mirrors `ListClientUpdatesForEngagement`'s own
 * operational "newest first" convention for the same underlying concept (an
 * update log a reader scans from the most recent), unlike
 * `GetClientTimeline`'s deliberately OLDEST-first factual narrative — see
 * that command's own header for why the two orderings, and the two
 * groupings, are each the right choice for what they show.
 *
 * Source: implementation-plan.md work package P9C-API-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "10. Publication Workflow", "11. Publication Contents".
 */

import type { ClientPublicationListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientPublicationReadRepository } from './client-publication-read-repository.js';
import type { ClientPortalAuthorization } from './client-portal-authorization.js';
import { toClientPublicationSummaryResource } from './client-portal-view.js';

export class ListClientPublications {
  constructor(
    private readonly authorization: ClientPortalAuthorization,
    private readonly publications: ClientPublicationReadRepository,
  ) {}

  async execute(clientProfileId: Uuid, clientGardenId: Uuid): Promise<ClientPublicationListResult> {
    await this.authorization.requireActiveGardenAccess(clientProfileId, clientGardenId);

    const versions = await this.publications.listVisibleForEngagement(clientGardenId);

    return { items: versions.map(toClientPublicationSummaryResource) };
  }
}
