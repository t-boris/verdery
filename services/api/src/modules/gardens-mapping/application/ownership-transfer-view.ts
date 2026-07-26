/**
 * Maps a domain `OwnershipTransfer` to the contract shape — the same
 * "application code returns the contract-shaped view" rule `garden-view.ts`
 * documents.
 */

import type { OwnershipTransfer as OwnershipTransferResource } from '@verdery/api-contracts';
import type { OwnershipTransfer } from '../domain/ownership-transfer.js';

export function toOwnershipTransferResource(
  transfer: OwnershipTransfer,
): OwnershipTransferResource {
  const resource: OwnershipTransferResource = {
    id: transfer.id,
    gardenId: transfer.gardenId,
    fromProfileId: transfer.fromProfileId,
    toProfileId: transfer.toProfileId,
    fromResultingRole: transfer.fromResultingRole,
    state: transfer.state,
    authenticatedAt: transfer.authenticatedAt.toISOString(),
    requestedAt: transfer.requestedAt.toISOString(),
  };

  // Assigned rather than conditionally spread so `exactOptionalPropertyTypes`
  // can see each key is only ever present with a real value — the same
  // posture `toInvitationResource` already takes.
  if (transfer.completedAt !== null) {
    resource.completedAt = transfer.completedAt.toISOString();
  }
  if (transfer.cancelledAt !== null) {
    resource.cancelledAt = transfer.cancelledAt.toISOString();
  }
  if (transfer.cancellationReason !== null) {
    resource.cancellationReason = transfer.cancellationReason;
  }

  return resource;
}
