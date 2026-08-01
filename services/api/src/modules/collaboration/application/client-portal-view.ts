/**
 * Maps internal repository detail shapes to the client-portal's OWN,
 * DELIBERATELY restricted contract shapes (P9C-API-01) — never a reuse of
 * `publication-view.ts`'s operational `PublicationItem`/
 * `PublicationStaffAttribution`/`PublicationVersion` mapping. See
 * `openapi.yaml`'s own comment above these schemas for the exact field-by-
 * field omission list (`sourceWorkLogId`, `staffProfileId`,
 * `engagementId`/`gardenId`/`clientUpdateId`/
 * `clientUpdateRevisionAtPublish`/`publishedByProfileId`) and why each is
 * left out.
 */

import type {
  ClientGarden,
  ClientGardenOverview,
  ClientPublicationItem,
  ClientPublicationStaffAttribution,
  ClientPublicationSummary,
  ClientTimelineEntry,
} from '@verdery/api-contracts';
import type { Garden } from '../../gardens-mapping/public.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientEngagementDetail } from './client-engagement-repository.js';
import type {
  PublicationItemDetail,
  PublicationStaffAttributionDetail,
  PublicationVersionDetail,
} from './publication-repository.js';

type GardenSnapshotItemDetail = Extract<
  PublicationItemDetail,
  { readonly kind: 'garden_snapshot' }
>;

/** One garden's own most-recently-granted-first ordering is `listActiveForProfile`'s job; this function only shapes one already-resolved (engagement, garden) pair. */
export function toClientGardenResource(
  engagement: ClientEngagementDetail,
  garden: Garden,
): ClientGarden {
  return { id: engagement.id, name: garden.name };
}

function toClientPublicationItemResource(item: PublicationItemDetail): ClientPublicationItem {
  const resource: ClientPublicationItem = {
    id: item.id,
    kind: item.kind,
    occurredAt: item.occurredAt.toISOString(),
  };

  switch (item.kind) {
    case 'work_log':
      resource.description = item.description;
      break;
    case 'media':
      resource.mediaId = item.mediaRecordId;
      resource.mediaRole = item.mediaRole;
      if (item.caption !== null) {
        resource.caption = item.caption;
      }
      break;
    case 'garden_snapshot':
      resource.overviewText = item.overviewText;
      if (item.snapshotData !== null) {
        resource.snapshotData = item.snapshotData as Record<string, unknown>;
      }
      break;
    case 'timeline_entry':
      resource.entryText = item.entryText;
      break;
    case 'observation':
      resource.narrativeText = item.narrativeText;
      break;
  }

  return resource;
}

function toClientTimelineEntryResource(
  item: PublicationItemDetail,
  publicationId: Uuid,
): ClientTimelineEntry {
  const resource: ClientTimelineEntry = {
    publicationId,
    kind: item.kind,
    occurredAt: item.occurredAt.toISOString(),
  };

  switch (item.kind) {
    case 'work_log':
      resource.description = item.description;
      break;
    case 'media':
      resource.mediaId = item.mediaRecordId;
      resource.mediaRole = item.mediaRole;
      if (item.caption !== null) {
        resource.caption = item.caption;
      }
      break;
    case 'garden_snapshot':
      resource.overviewText = item.overviewText;
      if (item.snapshotData !== null) {
        resource.snapshotData = item.snapshotData as Record<string, unknown>;
      }
      break;
    case 'timeline_entry':
      resource.entryText = item.entryText;
      break;
    case 'observation':
      resource.narrativeText = item.narrativeText;
      break;
  }

  return resource;
}

function toClientStaffAttributionResource(
  attribution: PublicationStaffAttributionDetail,
): ClientPublicationStaffAttribution {
  const resource: ClientPublicationStaffAttribution = {
    id: attribution.id,
    displayName: attribution.displayName,
  };
  if (attribution.roleLabel !== null) {
    resource.roleLabel = attribution.roleLabel;
  }
  return resource;
}

export function toClientPublicationSummaryResource(
  version: PublicationVersionDetail,
): ClientPublicationSummary {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    title: version.title,
    summary: version.summary,
    publishedAt: version.publishedAt.toISOString(),
    items: version.items.map(toClientPublicationItemResource),
    staffAttributions: version.staffAttributions.map(toClientStaffAttributionResource),
  };
}

/** Flattens every item of every visible version into ONE chronological sequence — `versions` must already be ordered however the caller wants ties broken; this function itself re-sorts strictly by `occurredAt` ascending, the factual-narrative order `getClientTimeline` promises. */
export function toClientTimelineEntries(
  versions: readonly PublicationVersionDetail[],
): ClientTimelineEntry[] {
  const entries = versions.flatMap((version) =>
    version.items.map((item) => toClientTimelineEntryResource(item, version.id)),
  );

  return entries.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
}

/** Honest-absence shape when no `garden_snapshot` item has ever been published (`hasSnapshot` is never modeled as a boolean — see the schema's own comment for why absence-of-fields is this codebase's established convention instead). */
export function toClientGardenOverviewResource(clientGardenId: Uuid): ClientGardenOverview {
  return { clientGardenId };
}

export function toClientGardenOverviewWithSnapshotResource(
  clientGardenId: Uuid,
  publicationId: Uuid,
  publishedAt: Date,
  snapshot: GardenSnapshotItemDetail,
): ClientGardenOverview {
  const resource: ClientGardenOverview = {
    clientGardenId,
    publicationId,
    overviewText: snapshot.overviewText,
    occurredAt: snapshot.occurredAt.toISOString(),
    publishedAt: publishedAt.toISOString(),
  };
  if (snapshot.snapshotData !== null) {
    resource.snapshotData = snapshot.snapshotData as Record<string, unknown>;
  }
  return resource;
}
