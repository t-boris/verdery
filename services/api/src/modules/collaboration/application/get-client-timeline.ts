/**
 * `GET /client/gardens/{clientGardenId}/timeline` (P9C-API-01) — the
 * factual Garden Timeline, collaboration-and-client-sharing.md section
 * 12.1: "composed from immutable published updates, completed-work
 * snapshots, selected media, and accepted garden snapshots with real
 * timestamps."
 *
 * HOW THIS GENUINELY DIFFERS FROM `ListClientPublications`, NOT JUST IN
 * NAME. Both read the identical visible-publication data
 * (`ClientPublicationReadRepository.listVisibleForEngagement`), but shape
 * it two structurally different ways:
 *
 *   - `ListClientPublications` groups by `publication_version` — each
 *     entry carries a title, a summary, and a bounded item list, answering
 *     "what did the publisher send me, and when" (a log of publish
 *     events), newest first.
 *   - This command DISCARDS the version grouping entirely: every item of
 *     every kind (`work_log`, `media`, `garden_snapshot`, `timeline_entry`
 *     — all four kinds section 12.1 names, not only the two narrative-text
 *     kinds a first reading of "work-log-kind and timeline-entry-kind
 *     items" might suggest) is flattened into ONE sequence ordered by its
 *     own `occurredAt`, oldest first, answering "what happened in this
 *     garden, and when" (a factual narrative), with no title/summary
 *     wrapper at all.
 *
 * This is a real, useful distinction given what P9C-DATA-01 actually
 * stores today (four independently-timestamped item kinds per version,
 * not one flat fact per publish event) — not two routes that happen to
 * return identically-shaped data under different names.
 *
 * ORDER: OLDEST FIRST, THE OPPOSITE OF `ListClientPublications`. A factual
 * narrative is read start-to-present, the same reason a timeline UI
 * conventionally scrolls forward through history rather than presenting
 * the newest fact first.
 *
 * Source: implementation-plan.md work package P9C-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "12. Garden Timeline and Time Machine".
 */

import type { ClientTimelineResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientPublicationReadRepository } from './client-publication-read-repository.js';
import type { ClientPortalAuthorization } from './client-portal-authorization.js';
import { toClientTimelineEntries } from './client-portal-view.js';

export class GetClientTimeline {
  constructor(
    private readonly authorization: ClientPortalAuthorization,
    private readonly publications: ClientPublicationReadRepository,
  ) {}

  async execute(clientProfileId: Uuid, clientGardenId: Uuid): Promise<ClientTimelineResult> {
    await this.authorization.requireActiveGardenAccess(clientProfileId, clientGardenId);

    const versions = await this.publications.listVisibleForEngagement(clientGardenId);

    return { items: toClientTimelineEntries(versions) };
  }
}
