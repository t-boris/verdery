/**
 * Maps a `ClientUpdateDetail` (plus its currently staged items) to the exact
 * `ClientUpdate`/`ClientUpdateItem` contract shapes — the same "application
 * code returns the contract-shaped view" rule `organization-view.ts`
 * documents. `items` is always populated (never omitted) — see
 * `ClientUpdate.items`'s own contract description.
 */

import type { ClientUpdate, ClientUpdateItem } from '@verdery/api-contracts';
import type { ClientUpdateDetail } from './client-update-repository.js';
import type { ClientUpdateItemDetail } from './client-update-item-repository.js';

export function toClientUpdateItemResource(item: ClientUpdateItemDetail): ClientUpdateItem {
  const resource: ClientUpdateItem = {
    id: item.id,
    clientUpdateId: item.clientUpdateId,
    kind: item.kind,
    occurredAt: item.occurredAt.toISOString(),
    createdAt: item.createdAt.toISOString(),
  };

  if (item.sourceWorkLogId !== null) {
    resource.sourceWorkLogId = item.sourceWorkLogId;
  }
  if (item.description !== null) {
    resource.description = item.description;
  }
  if (item.mediaRecordId !== null) {
    resource.mediaRecordId = item.mediaRecordId;
  }
  if (item.mediaRole !== null) {
    resource.mediaRole = item.mediaRole;
  }
  if (item.caption !== null) {
    resource.caption = item.caption;
  }
  if (item.sourceObservationId !== null) {
    resource.sourceObservationId = item.sourceObservationId;
  }

  return resource;
}

export function toClientUpdateResource(
  update: ClientUpdateDetail,
  items: readonly ClientUpdateItemDetail[],
): ClientUpdate {
  const resource: ClientUpdate = {
    id: update.id,
    engagementId: update.engagementId,
    gardenId: update.gardenId,
    state: update.state,
    title: update.title,
    revision: update.revision,
    createdByProfileId: update.createdByProfileId,
    createdAt: update.createdAt.toISOString(),
    updatedAt: update.updatedAt.toISOString(),
    items: items.map(toClientUpdateItemResource),
  };

  if (update.summary !== null) {
    resource.summary = update.summary;
  }
  if (update.submittedAt !== null) {
    resource.submittedAt = update.submittedAt.toISOString();
  }
  if (update.publishedAt !== null) {
    resource.publishedAt = update.publishedAt.toISOString();
  }
  if (update.publishedByProfileId !== null) {
    resource.publishedByProfileId = update.publishedByProfileId;
  }
  if (update.withdrawnAt !== null) {
    resource.withdrawnAt = update.withdrawnAt.toISOString();
  }
  if (update.withdrawnByProfileId !== null) {
    resource.withdrawnByProfileId = update.withdrawnByProfileId;
  }
  if (update.withdrawnReason !== null) {
    resource.withdrawnReason = update.withdrawnReason;
  }

  return resource;
}
