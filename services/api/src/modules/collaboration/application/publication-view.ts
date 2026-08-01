/**
 * Maps a `PublicationVersionDetail` to the exact `PublicationVersion`
 * contract shape — the same "application code returns the contract-shaped
 * view" rule `organization-view.ts` documents. Every kind-discriminated
 * `PublicationItemDetail` variant flattens onto the ONE `PublicationItem`
 * contract schema (optional per-kind fields), matching how
 * `client-update-view.ts` flattens `ClientUpdateItemDetail`.
 */

import type {
  PublicationItem,
  PublicationStaffAttribution,
  PublicationVersion,
} from '@verdery/api-contracts';
import type {
  PublicationItemDetail,
  PublicationStaffAttributionDetail,
  PublicationVersionDetail,
} from './publication-repository.js';

function toPublicationItemResource(
  item: PublicationItemDetail,
  publicationVersionId: string,
): PublicationItem {
  const resource: PublicationItem = {
    id: item.id,
    publicationVersionId,
    kind: item.kind,
    occurredAt: item.occurredAt.toISOString(),
    createdAt: item.occurredAt.toISOString(),
  };

  switch (item.kind) {
    case 'work_log':
      resource.description = item.description;
      if (item.sourceWorkLogId !== null) {
        resource.sourceWorkLogId = item.sourceWorkLogId;
      }
      break;
    case 'media':
      resource.mediaRecordId = item.mediaRecordId;
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
      if (item.sourceObservationId !== null) {
        resource.sourceObservationId = item.sourceObservationId;
      }
      break;
  }

  return resource;
}

function toPublicationStaffAttributionResource(
  attribution: PublicationStaffAttributionDetail,
  publicationVersionId: string,
): PublicationStaffAttribution {
  const resource: PublicationStaffAttribution = {
    id: attribution.id,
    publicationVersionId,
    staffProfileId: attribution.staffProfileId,
    displayName: attribution.displayName,
    createdAt: attribution.createdAt.toISOString(),
  };

  if (attribution.roleLabel !== null) {
    resource.roleLabel = attribution.roleLabel;
  }

  return resource;
}

export function toPublicationVersionResource(
  version: PublicationVersionDetail,
): PublicationVersion {
  return {
    id: version.id,
    clientUpdateId: version.clientUpdateId,
    engagementId: version.engagementId,
    gardenId: version.gardenId,
    versionNumber: version.versionNumber,
    title: version.title,
    summary: version.summary,
    clientUpdateRevisionAtPublish: version.clientUpdateRevisionAtPublish,
    publishedAt: version.publishedAt.toISOString(),
    publishedByProfileId: version.publishedByProfileId,
    createdAt: version.createdAt.toISOString(),
    items: version.items.map((item) => toPublicationItemResource(item, version.id)),
    staffAttributions: version.staffAttributions.map((attribution) =>
      toPublicationStaffAttributionResource(attribution, version.id),
    ),
  };
}
