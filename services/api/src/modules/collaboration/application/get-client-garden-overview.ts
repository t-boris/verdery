/**
 * `GET /client/gardens/{clientGardenId}/overview` (P9C-API-01) — the
 * accepted-garden overview a client sees for one garden: the `overviewText`/
 * `snapshotData` of the `garden_snapshot`-kind `publication_item` on the
 * MOST RECENTLY published visible version that included one, if any.
 *
 * WHAT "OVERVIEW" MEANS WITH NO SNAPSHOT YET. A garden can have zero, one,
 * or many published updates, and any given update may or may not have
 * included a `gardenSnapshot` (`PublishClientUpdateRequest.gardenSnapshot`
 * is optional — "a publication with zero items is valid"). This command
 * therefore returns an HONEST ABSENCE — `200` with only `clientGardenId`
 * set, no `overviewText`/`snapshotData`/`occurredAt`/`publicationId` — when
 * no publication has ever carried one, rather than a `404` (the garden and
 * the caller's own access to it are both perfectly real; there is simply
 * nothing to show yet) or a fabricated placeholder value (which section
 * 12.2's "never interpolate an invented historical state" bars for the
 * Timeline and applies here with equal force).
 *
 * SCANS RATHER THAN QUERYING A DEDICATED "LATEST SNAPSHOT" SQL SHAPE. This
 * reuses `ClientPublicationReadRepository.listVisibleForEngagement` (already
 * ordered newest-published first) and picks the first `garden_snapshot`
 * item found across versions, rather than adding a fourth bespoke query —
 * see that repository's own header for why one method is shared across all
 * three P9C-API-01 read commands.
 *
 * Source: implementation-plan.md work package P9C-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "11. Publication Contents".
 */

import type { ClientGardenOverview } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientPublicationReadRepository } from './client-publication-read-repository.js';
import type { ClientPortalAuthorization } from './client-portal-authorization.js';
import {
  toClientGardenOverviewResource,
  toClientGardenOverviewWithSnapshotResource,
} from './client-portal-view.js';

export class GetClientGardenOverview {
  constructor(
    private readonly authorization: ClientPortalAuthorization,
    private readonly publications: ClientPublicationReadRepository,
  ) {}

  async execute(clientProfileId: Uuid, clientGardenId: Uuid): Promise<ClientGardenOverview> {
    await this.authorization.requireActiveGardenAccess(clientProfileId, clientGardenId);

    const versions = await this.publications.listVisibleForEngagement(clientGardenId);

    for (const version of versions) {
      const snapshot = version.items.find((item) => item.kind === 'garden_snapshot');
      if (snapshot !== undefined && snapshot.kind === 'garden_snapshot') {
        return toClientGardenOverviewWithSnapshotResource(
          clientGardenId,
          version.id,
          version.publishedAt,
          snapshot,
        );
      }
    }

    return toClientGardenOverviewResource(clientGardenId);
  }
}
