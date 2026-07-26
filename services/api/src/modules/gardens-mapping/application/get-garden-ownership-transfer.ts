/**
 * Reads a garden's currently PENDING ownership transfer (P9A-OWNER-02) —
 * the read this module's write-only ownership-transfer surface (P9A-OWNER-01)
 * never had, closing a real gap: the initiating owner had no way to confirm a
 * requested transfer was still pending after a page reload except attempting
 * `cancelGardenOwnershipTransfer` and reading a `404` as "nothing was
 * pending", and the named recipient had no garden-scoped way to check at all.
 *
 * READABLE BY TWO PARTIES, deliberately narrower than every write command on
 * this same resource:
 *
 *   1. The current owner (`administerOwnership`) — the initiator checking on
 *      a transfer THEY requested. Unlike `cancelGardenOwnershipTransfer`,
 *      this is not restricted to whoever the acting owner happens to be
 *      right now versus who actually opened the request; any active owner
 *      may read it, the same "the owner set may act on the garden's own
 *      administrative state" posture `administerOwnership` already grants.
 *   2. The named recipient (`toProfileId === caller`) — checking an offer
 *      addressed to them without needing `administerOwnership`, mirroring
 *      exactly who `acceptOwnershipTransfer`/`declineOwnershipTransfer`
 *      already let act on this same row.
 *
 * ANYONE ELSE — an editor or viewer who is neither the owner nor the named
 * recipient — gets the IDENTICAL `404` as "nothing pending", never a `403`.
 * This is not a new concealment device: it is the same posture
 * `AcceptOwnershipTransfer`'s own `pending.toProfileId !== actor.profileId`
 * check already applies (see that file's header, re-validation point 1) —
 * a caller with no standing over a transfer must not learn one exists
 * naming someone else, or naming the current owner, either.
 *
 * NO NEW REPOSITORY METHOD FOR THIS HALF: `findPendingForGarden` — the
 * existing UNLOCKED pre-check `TransferOwnership` already uses — is reused
 * exactly as-is. This is a plain read with no state transition to protect
 * against a concurrent writer, so the row-locking `lockPendingForGarden`
 * exists for is neither needed nor appropriate here; adding a third
 * repository method that wrapped the identical query plus this
 * capability-or-identity check would only duplicate `findPendingForGarden`'s
 * own SQL. The authorization decision belongs here, in the query class, for
 * a concrete reason beyond taste: `requireCapability` already returns the
 * caller's `Membership` (with its `role`) as a side effect of the visibility
 * gate below, so the query class already holds everything the "administer or
 * addressee" decision needs without a second database round trip or a join
 * into `collaboration.membership` from a repository that has never needed
 * one before.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01, extended by
 * P9A-OWNER-02; architecture/identity-and-authorization.md, section
 * "11. Ownership Transfer".
 */

import type { OwnershipTransfer as OwnershipTransferResource } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import { roleHasCapability } from '../domain/garden-role.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { OwnershipTransferRepository } from './ownership-transfer-repository.js';
import { toOwnershipTransferResource } from './ownership-transfer-view.js';

function transferNotFoundForCaller(): NotFoundError {
  return new NotFoundError(
    CollaborationErrorCode.OwnershipTransferNotFound,
    'No pending ownership transfer exists for this garden that you have standing to view.',
  );
}

export class GetGardenOwnershipTransfer {
  constructor(
    private readonly ownershipTransfers: OwnershipTransferRepository,
    private readonly authorization: GardenAuthorization,
  ) {}

  async execute(gardenId: Uuid, callerProfileId: Uuid): Promise<OwnershipTransferResource> {
    // `viewGarden`: the base membership gate every active role holds, and
    // the concealed-existence 404 for a caller with no membership at all —
    // identical to `GetGarden`'s own first step. The returned membership's
    // `role` is what the visibility check below needs; no second query.
    const membership = await this.authorization.requireCapability(
      gardenId,
      callerProfileId,
      'viewGarden',
    );

    const pending = await this.ownershipTransfers.findPendingForGarden(gardenId);
    const callerAdministers = roleHasCapability(membership.role, 'administerOwnership');

    if (pending === null || (!callerAdministers && pending.toProfileId !== callerProfileId)) {
      throw transferNotFoundForCaller();
    }

    return toOwnershipTransferResource(pending);
  }
}
