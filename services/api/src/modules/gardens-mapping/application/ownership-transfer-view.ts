/**
 * Maps a domain `OwnershipTransfer` to the contract shape — the same
 * "application code returns the contract-shaped view" rule `garden-view.ts`
 * documents.
 */

import type {
  IncomingOwnershipTransfer as IncomingOwnershipTransferResource,
  OwnershipTransfer as OwnershipTransferResource,
} from '@verdery/api-contracts';
import type { OwnershipTransfer } from '../domain/ownership-transfer.js';
import type { IncomingOwnershipTransfer } from './ownership-transfer-repository.js';

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

/**
 * Maps an `IncomingOwnershipTransfer` (a PENDING transfer joined with its
 * destination garden's name — see `ownership-transfer-repository.ts`'s own
 * header) to the contract shape `listIncomingOwnershipTransfers` returns.
 */
export function toIncomingOwnershipTransferResource(
  transfer: IncomingOwnershipTransfer,
): IncomingOwnershipTransferResource {
  return {
    ...toOwnershipTransferResource(transfer),
    gardenName: transfer.gardenName,
  };
}
