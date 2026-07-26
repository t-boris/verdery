/**
 * Lists every PENDING ownership transfer addressed to the caller
 * (`toProfileId`), across EVERY garden (P9A-OWNER-02) — the read that
 * actually removes the "recipient has no way to discover an offer" gap:
 * before this, the only way a recipient could learn a transfer named them
 * was out of band, from the initiator.
 *
 * PROFILE-SCOPED, NOT GARDEN-SCOPED — no `gardenId` path segment and no
 * `GardenAuthorization` capability check, mirroring `ListGardens` exactly
 * (see that file and `GET /gardens` in `garden-routes.ts`): "every pending
 * transfer naming me" is inherently scoped to the caller's own identity, the
 * same way "every garden I belong to" is. There is no garden to authorize
 * against before the caller even knows which gardens are involved — that is
 * the entire point of this endpoint over the garden-scoped
 * `GetGardenOwnershipTransfer`, which requires already knowing a `gardenId`.
 *
 * Each item carries the destination garden's own name
 * (`IncomingOwnershipTransfer.gardenName`) — see
 * `ownership-transfer-repository.ts`'s own header for why joining it in is
 * both cheap and consistent with this module's existing layering. A
 * recipient deciding whether to accept ownership of a garden they cannot
 * even name would be a materially worse experience than seeing which one.
 *
 * A pure read, not wrapped in the transactional unit of work — the same
 * posture every other query in this module already takes.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01, extended by
 * P9A-OWNER-02.
 */

import type { IncomingOwnershipTransferListResult } from '@verdery/api-contracts';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OwnershipTransferRepository } from './ownership-transfer-repository.js';
import { toIncomingOwnershipTransferResource } from './ownership-transfer-view.js';

export class ListIncomingOwnershipTransfers {
  constructor(private readonly ownershipTransfers: OwnershipTransferRepository) {}

  async execute(profileId: Uuid): Promise<IncomingOwnershipTransferListResult> {
    const items = await this.ownershipTransfers.listIncomingForProfile(profileId);

    return { items: items.map(toIncomingOwnershipTransferResource) };
  }
}
