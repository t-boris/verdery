/**
 * Declines a PENDING ownership transfer as its named recipient (P9A-OWNER-01,
 * companion to `AcceptOwnershipTransfer`).
 *
 * A DISTINCT COMMAND FROM `CancelOwnershipTransfer`, DELIBERATELY, rather than
 * that command's authorization widened to also accept the target's own
 * identity. `CancelOwnershipTransfer` is owner-only
 * (`administerOwnership`) — a non-owner target holds no such capability, so
 * today it literally cannot call it; widening that gate to
 * "`administerOwnership` OR you are `to_profile_id`" would make one
 * authorization check answer two unrelated questions ("may this owner
 * withdraw a request they controlled" vs. "may this recipient refuse an
 * offer made TO them") and would blur two audit facts this codebase's own
 * established style keeps separate even when they share a mechanism — the
 * same judgment `AcceptInvitation` already makes in emitting
 * `invitation.accepted` and `membership.granted` as two distinct rows for one
 * request, and `RemoveMember` makes in recording `removedBySelf` rather than
 * inventing a second command for self-removal. A recipient saying no to an
 * offer and an initiator withdrawing their own request are different facts
 * about different actors' intent, worth two event types
 * (`ownership_transfer.declined` vs. `.cancelled`) even though both resolve
 * to the SAME terminal `state = 'cancelled'` — the schema has no third
 * terminal state to spend on this distinction, and does not need one: the
 * `cancellation_reason` column already exists for free-text detail, and
 * `'declined_by_recipient'` here is exactly that, not a new column or a new
 * enum value. `CancelOwnershipTransfer` itself is UNCHANGED by this file:
 * still owner-only, still `null` for its own reason, still describing the
 * initiator's own withdrawal.
 *
 * SHARES ITS "RESOLVE THE TRANSFER ADDRESSED TO ME" STEP WITH
 * `AcceptOwnershipTransfer`: `lockPendingForGarden`, then a `toProfileId`
 * match, then `collaboration.ownership_transfer.not_found` if either fails —
 * see that file's header, re-validation point 1, and
 * `ownership-transfer-repository.ts`'s header for why the LOCKED read is the
 * one to use here too (declining and accepting the SAME transfer are racing
 * writers against the identical row, exactly like declining and the
 * initiator's own cancel are).
 *
 * NO further re-validation is needed beyond that: unlike accepting, declining
 * touches no membership row and asserts nothing about the current owner —
 * refusing an offer is valid regardless of whether the offer's premise still
 * holds by the time it is refused.
 *
 * NO RECENT-AUTH GATE, for the same reason `AcceptOwnershipTransfer` gives
 * and `CancelOwnershipTransfer`'s own header already established for the
 * initiator's side: declining reverses nothing that has already taken
 * effect, and the caller is disposing only of an offer addressed to
 * themselves, not administering anyone else.
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
import { cancelOwnershipTransfer as buildDeclined } from '../domain/ownership-transfer.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toOwnershipTransferResource } from './ownership-transfer-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'ownership_transfer.decline';
const DECLINE_REASON = 'declined_by_recipient';

/** The narrow actor shape this command needs — just an identity; see this file's header for why declining is not recent-auth-gated. */
export interface OwnershipTransferDeclineActor {
  readonly profileId: Uuid;
}

function transferNotFoundForCaller(): NotFoundError {
  return new NotFoundError(
    CollaborationErrorCode.OwnershipTransferNotFound,
    'No pending ownership transfer exists for this garden addressed to you.',
  );
}

export class DeclineOwnershipTransfer {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    actor: OwnershipTransferDeclineActor,
    idempotencyKey: string,
  ): Promise<OwnershipTransferResource> {
    // `viewGarden`, matching `AcceptOwnershipTransfer` exactly — see that
    // file's header for why this is the right base gate for a caller who
    // administers nobody, only an offer addressed to themselves.
    await this.authorization.requireCapability(gardenId, actor.profileId, 'viewGarden');

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const pending = await context.ownershipTransfers.lockPendingForGarden(gardenId);
      if (pending === null || pending.toProfileId !== actor.profileId) {
        throw transferNotFoundForCaller();
      }

      const now = this.clock.now();
      const declined = buildDeclined(pending, now, DECLINE_REASON);
      await context.ownershipTransfers.update(declined);

      await context.auditLogger.record({
        eventType: 'ownership_transfer.declined',
        subjectType: 'ownership_transfer',
        subjectId: declined.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId,
        details: { fromProfileId: declined.fromProfileId },
      });
      await context.outbox.append({
        eventType: 'ownership_transfer.declined',
        aggregateType: 'ownership_transfer',
        aggregateId: declined.id,
        payload: { gardenId, fromProfileId: declined.fromProfileId, toProfileId: actor.profileId },
      });

      return toOwnershipTransferResource(declined);
    });
  }
}
