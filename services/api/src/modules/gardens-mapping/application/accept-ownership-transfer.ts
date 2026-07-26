/**
 * Accepts a PENDING ownership transfer as its named recipient (P9A-OWNER-01,
 * matrix row H13) — the command that actually MOVES ownership, now that the
 * owner has overridden this codebase's first no-acceptance reading of
 * section 11 (see `domain/ownership-transfer.ts`'s header for the full
 * argument and `transfer-ownership.ts`'s header for what that command does
 * instead, now that it only requests).
 *
 * IDENTIFIED BY GARDEN PLUS THE CALLER'S OWN IDENTITY, NOT A TOKEN — unlike
 * `AcceptInvitation`, which resolves its subject through an opaque token
 * because an invitation names no account until one accepts it. A pending
 * transfer already names a real `to_profile_id`; the caller IS that person or
 * they are not, which `findPendingForGarden`'s `toProfileId` check below
 * decides directly. Both the token-shaped and identity-shaped forms answer
 * the same question ("is the caller the one this was addressed to?"); a
 * transfer just already has the identity on file, so a second addressing
 * mechanism would be redundant.
 *
 * RE-VALIDATES EVERYTHING AT ACCEPTANCE TIME, UNDER LOCK, NOT JUST AT REQUEST
 * TIME — because an unbounded amount of time and an unbounded number of OTHER
 * commands can run between `TransferOwnership`'s insert and this command's
 * accept:
 *
 *   1. The pending transfer must still exist and still be `pending` —
 *      `lockPendingForGarden`, not the unlocked `findPendingForGarden`; see
 *      `ownership-transfer-repository.ts`'s header for why an unlocked read
 *      is not safe here (a concurrent `CancelOwnershipTransfer` or
 *      `DeclineOwnershipTransfer` could otherwise both pass a stale read and
 *      race this command to a contradictory outcome). Absent, or naming a
 *      different recipient, is reported identically
 *      (`collaboration.ownership_transfer.not_found`) — the same concealment
 *      posture `MembershipNotFound` already applies elsewhere in this module:
 *      a caller must not learn that a transfer exists for somebody else.
 *   2. `from_profile_id` must STILL be an active owner right now. They may
 *      have been demoted (`DemoteOwner`), removed (`RemoveMember`), or have
 *      transferred ownership again elsewhere entirely while this stayed
 *      pending — none of which cancels or updates a transfer they are no
 *      longer the source of, because `DemoteOwner`/`RemoveMember` are
 *      deliberately unaware of `collaboration.ownership_transfer` (see
 *      `promote-to-owner.ts`/`demote-owner.ts`'s own headers: their policy is
 *      untouched by this work package). Reported as
 *      `collaboration.membership.target_not_owner` — reused rather than
 *      given a new code, because it is the exact same fact `DemoteOwner`
 *      already names it for: the profile on the other end of this operation
 *      does not currently hold `owner`.
 *   3. The caller's OWN membership must still be active and not already
 *      `owner` (a concurrent `PromoteToOwner` could have made them a co-owner
 *      already; a concurrent `RemoveMember` self-removal could have ended
 *      their membership entirely). Reported as
 *      `collaboration.membership.not_found` or
 *      `collaboration.membership.target_already_owner` respectively — both
 *      reused from `TransferOwnership`'s own target validation, since accept
 *      re-checks the identical two facts about the identical role, just
 *      re-read at a later instant by the person themselves instead of by the
 *      initiator.
 *
 * Any failure here leaves EVERYTHING exactly as it was: the transfer stays
 * `pending` (or whatever terminal state a concurrent cancel/decline already
 * moved it to), no membership row is touched. Nothing is corrected or
 * self-healed on the caller's behalf — a stale transfer just sits there until
 * an owner cancels it (`CancelOwnershipTransfer`, unrestricted by this) or the
 * next accept attempt fails the same way.
 *
 * NO RECENT-AUTH GATE ON THIS SIDE, deliberately, matching `AcceptInvitation`
 * rather than `TransferOwnership`/`PromoteToOwner`/`DemoteOwner`. Every
 * recent-auth gate in this module protects a caller ADMINISTERING someone
 * ELSE'S access — the risk section 11 names is a mistaken or coerced action
 * taken FOR another person. Accepting is the opposite shape: the caller is
 * disposing only of an offer addressed to THEMSELVES, the same risk category
 * `AcceptInvitation` already reasons about for becoming a member at all.
 * Gating self-directed acceptance behind a 30-minute-old sign-in would be a
 * new, unjustified friction this module has never applied to any other
 * "accept something offered to me" action.
 *
 * ATOMIC TWO-SIDED WRITE, mirroring exactly what `TransferOwnership` used to
 * do inline before this rework: close `from`'s open period at its recorded
 * `fromResultingRole`, close `to`'s (the caller's own) open period at `owner`,
 * mark the transfer `completed`, all in one transaction.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer";
 * docs/development/garden-capability-matrix.md, row H13;
 * migrations/1786500000000_collaboration-operations-and-attribution.sql.
 */

import type { OwnershipTransfer as OwnershipTransferResource } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { completeOwnershipTransfer } from '../domain/ownership-transfer.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toOwnershipTransferResource } from './ownership-transfer-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'ownership_transfer.accept';

/** The narrow actor shape this command needs — just an identity, no `authenticatedAt`; see this file's header for why acceptance is not recent-auth-gated. */
export interface OwnershipTransferAcceptActor {
  readonly profileId: Uuid;
}

function transferNotFoundForCaller(): NotFoundError {
  return new NotFoundError(
    CollaborationErrorCode.OwnershipTransferNotFound,
    'No pending ownership transfer exists for this garden addressed to you.',
  );
}

function sourceNotOwner(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    CollaborationErrorCode.TargetNotOwner,
    'The profile offering ownership is no longer an active owner of this garden.',
  );
}

function membershipNotFound(): NotFoundError {
  return new NotFoundError(
    CollaborationErrorCode.MembershipNotFound,
    'No active membership exists for this profile on this garden.',
  );
}

function alreadyOwner(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    CollaborationErrorCode.TargetAlreadyOwner,
    'This member is already an owner.',
  );
}

export class AcceptOwnershipTransfer {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    actor: OwnershipTransferAcceptActor,
    idempotencyKey: string,
  ): Promise<OwnershipTransferResource> {
    // `viewGarden`, the capability every active role holds: this call must
    // succeed for the concealment check to work at all (the caller holds no
    // administrative capability over anyone — they are only accepting an
    // offer addressed to themselves), and it doubles as the same
    // garden-existence concealment and lifecycle-state gate every other
    // command in this module already funnels through.
    const toMembership = await this.authorization.requireCapability(
      gardenId,
      actor.profileId,
      'viewGarden',
    );

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      // THE FIRST LOCK: the transfer row itself, before anything else is
      // read or written — see `ownership-transfer-repository.ts`'s header
      // for why this must be the locked read, not `findPendingForGarden`.
      // This alone serializes this command against a concurrent
      // `CancelOwnershipTransfer`/`DeclineOwnershipTransfer` on the SAME row.
      const pending = await context.ownershipTransfers.lockPendingForGarden(gardenId);
      if (pending === null || pending.toProfileId !== actor.profileId) {
        throw transferNotFoundForCaller();
      }

      // Re-validate the SOURCE side under lock, immediately before writing —
      // see this file's header, re-validation point 2.
      const fromMembership = await context.memberships.findActiveByGardenAndProfile(
        gardenId,
        pending.fromProfileId,
      );
      if (fromMembership === null) {
        throw sourceNotOwner();
      }
      const lockedFrom = await context.memberships.lockMembership(fromMembership.id);
      if (lockedFrom === null || lockedFrom.state !== 'active' || lockedFrom.role !== 'owner') {
        throw sourceNotOwner();
      }

      // Re-validate the RECIPIENT side — the caller's own membership, locked
      // by the id `requireCapability` already resolved above. See this
      // file's header, re-validation point 3.
      const lockedTo = await context.memberships.lockMembership(toMembership.id);
      if (lockedTo === null || lockedTo.state !== 'active') {
        throw membershipNotFound();
      }
      if (lockedTo.role === 'owner') {
        throw alreadyOwner();
      }

      const now = this.clock.now();

      await context.memberships.closeOpenPeriod(lockedFrom.id, now, 'role_changed');
      await context.memberships.changeRole(lockedFrom.id, pending.fromResultingRole, now);
      await context.memberships.openPeriod({
        id: generateUuidV7(),
        membershipId: lockedFrom.id,
        gardenId,
        profileId: pending.fromProfileId,
        role: pending.fromResultingRole,
        validFrom: now,
      });

      await context.memberships.closeOpenPeriod(lockedTo.id, now, 'role_changed');
      await context.memberships.changeRole(lockedTo.id, 'owner', now);
      await context.memberships.openPeriod({
        id: generateUuidV7(),
        membershipId: lockedTo.id,
        gardenId,
        profileId: actor.profileId,
        role: 'owner',
        validFrom: now,
      });

      const completed = completeOwnershipTransfer(pending, now);
      await context.ownershipTransfers.update(completed);

      await context.auditLogger.record({
        eventType: 'ownership_transfer.completed',
        subjectType: 'ownership_transfer',
        subjectId: completed.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId,
        details: {
          fromProfileId: pending.fromProfileId,
          fromResultingRole: pending.fromResultingRole,
        },
      });
      await context.outbox.append({
        eventType: 'ownership_transfer.completed',
        aggregateType: 'ownership_transfer',
        aggregateId: completed.id,
        payload: {
          gardenId,
          fromProfileId: pending.fromProfileId,
          toProfileId: actor.profileId,
          fromResultingRole: pending.fromResultingRole,
        },
      });

      return toOwnershipTransferResource(completed);
    });
  }
}
