/**
 * Cancels a garden's currently PENDING ownership transfer (P9A-OWNER-01,
 * companion to `TransferOwnership`).
 *
 * NOW THE REACHABLE HAPPY PATH, not the rare case this file's header used to
 * describe. That description was written against the codebase's FIRST,
 * no-acceptance reading of section 11, under which `TransferOwnership`
 * completed a transfer within the same transaction that created it, so a
 * `pending` row was a narrow edge case (a losing concurrent request) rather
 * than the ordinary in-between state. The owner has since overridden that
 * reading (see `domain/ownership-transfer.ts`'s header): every transfer now
 * stays `pending` until `AcceptOwnershipTransfer` completes it or
 * `DeclineOwnershipTransfer`/this command cancels it, so an initiator
 * changing their mind before the recipient acts is the ORDINARY case this
 * command exists for, not the rare one.
 *
 * Owner-only (`administerOwnership`) — UNCHANGED. This command is the
 * INITIATOR-side withdrawal specifically; a non-owner recipient who wants to
 * refuse the offer instead has `DeclineOwnershipTransfer`, a distinct command
 * with its own authorization — see that file's header for why the two are
 * not merged. Deliberately NOT recent-auth-gated, unlike its administering
 * siblings: cancelling reverses nothing that has already taken effect (no
 * role has changed, no membership has moved) — it only prevents a
 * not-yet-applied transfer from applying, the same asymmetry
 * `RevokeInvitation` already has against `CreateInvitation` (revoking an
 * unaccepted invitation needs no recent auth either, though invitations were
 * never recent-auth-gated to begin with; the comparison is to the SHAPE of
 * the asymmetry, not a claim that invitations are equally sensitive).
 *
 * THE ONE LOGIC CHANGE THIS REWORK REQUIRES: the lookup below now runs
 * `lockPendingForGarden` rather than the unlocked `findPendingForGarden` it
 * used before. That distinction did not matter under the no-acceptance
 * policy — nothing else could ever be racing to change the SAME pending row,
 * since the only other writer was `TransferOwnership`'s own insert, guarded
 * by the unique index. It matters now: `AcceptOwnershipTransfer` and
 * `DeclineOwnershipTransfer` are genuine concurrent writers against the exact
 * same row this command targets, and `KyselyOwnershipTransferRepository
 * .update` carries no state guard of its own (see
 * `ownership-transfer-repository.ts`'s header for the corrupted-outcome this
 * closes: an unlocked read here could let this command overwrite a transfer
 * `AcceptOwnershipTransfer` already completed, leaving the transfer row
 * claiming `cancelled` while both membership rows already moved). Everything
 * else below is unchanged.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer".
 */

import type { OwnershipTransfer as OwnershipTransferResource } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { cancelOwnershipTransfer as buildCancelled } from '../domain/ownership-transfer.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toOwnershipTransferResource } from './ownership-transfer-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'ownership_transfer.cancel';

export class CancelOwnershipTransfer {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<OwnershipTransferResource> {
    await this.authorization.requireCapability(gardenId, actorProfileId, 'administerOwnership');

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const pending = await context.ownershipTransfers.lockPendingForGarden(gardenId);
      if (pending === null) {
        throw new NotFoundError(
          CollaborationErrorCode.OwnershipTransferNotFound,
          'No pending ownership transfer exists for this garden.',
        );
      }

      const now = this.clock.now();
      const cancelled = buildCancelled(pending, now, null);
      await context.ownershipTransfers.update(cancelled);

      await context.auditLogger.record({
        eventType: 'ownership_transfer.cancelled',
        subjectType: 'ownership_transfer',
        subjectId: cancelled.id,
        actorProfileId,
        actorType: 'user',
        gardenId,
        details: { toProfileId: cancelled.toProfileId },
      });
      await context.outbox.append({
        eventType: 'ownership_transfer.cancelled',
        aggregateType: 'ownership_transfer',
        aggregateId: cancelled.id,
        payload: { gardenId },
      });

      return toOwnershipTransferResource(cancelled);
    });
  }
}
