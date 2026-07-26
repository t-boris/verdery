/**
 * Requests a transfer of garden ownership from the acting owner to another
 * active member (P9A-OWNER-01, matrix row H13). See `domain/ownership-
 * transfer.ts`'s header for the promotion/demotion-vs-transfer distinction
 * and for the full reasoning behind the confirmation policy this command
 * implements.
 *
 * Owner-only (`administerOwnership`) plus a RECENT authentication, exactly
 * like `PromoteToOwner`/`DemoteOwner`.
 *
 * THIS COMMAND ONLY REQUESTS. It validates the caller and the target, inserts
 * the `ownership_transfer` row as `pending`, and STOPS — it never touches
 * either membership's role or period. `AcceptOwnershipTransfer` is the ONLY
 * command that completes a transfer; see that file's header for the
 * acceptance-time re-validation and the atomic two-sided role change. The
 * caller REMAINS owner, with full `administerOwnership`, for the entire
 * pending window: nothing about THIS request removes anyone's capability.
 *
 * WHY THIS COMMAND DOES NOT RUN `lockActiveOwnerIds`: it does not change any
 * membership's role at all, so the last-owner invariant — which only
 * `lockActiveOwnerIds` protects — is not at stake here. It becomes relevant
 * only when `AcceptOwnershipTransfer` actually moves the two roles, which is
 * where the equivalent reasoning belongs instead (see that file's header:
 * the post-transition owner set is provably non-empty for the same "always
 * removes exactly one, always adds exactly one" reason this file used to
 * give for its own, now-removed, write).
 *
 * `lockMembership` still runs on BOTH sides, for the same reason it always
 * did (closing gap G-15, matching `PromoteToOwner`): re-reading the caller's
 * own membership, and the target's, under a row lock immediately before the
 * INSERT catches a concurrent change to either side and reports a clean
 * error rather than recording a transfer request against stale data. It just
 * no longer feeds a role-change write of its own — only the validation that
 * decides whether the insert may proceed at all.
 *
 * CONFIRMATION POLICY (the judgment call `docs/architecture/identity-and-
 * authorization.md` section 11 leaves open — see `domain/ownership-transfer
 * .ts`'s header for the full argument, including why the owner overrode this
 * codebase's first, no-acceptance reading): the `ownership_transfer` row is
 * written as `pending` and left there. This is what gives the
 * `ownership_transfer_pending_key` partial unique index (and this command's
 * OWN pre-check, `findPendingForGarden`) a real row to conflict against for
 * the genuine concurrent-request case the migration's comment names ("the
 * second concurrent request fails on the index instead of racing the first
 * to a contradictory outcome"), and is what makes `CancelOwnershipTransfer`
 * and `DeclineOwnershipTransfer` real commands against real data — see those
 * files' headers.
 *
 * THE OLD KNOWN LIMITATION IS GONE: the previous, completing version of this
 * command was never safely retryable by its own `Idempotency-Key` after
 * success, because completing always removed the caller's own
 * `administerOwnership`, so a retry failed `requireCapability` before
 * reaching the idempotency check. Since this command no longer changes
 * anyone's role, the caller keeps `administerOwnership` throughout the
 * pending window, and an ordinary dropped-response retry with the same key
 * now replays cleanly like every other command in this module.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer";
 * docs/development/garden-capability-matrix.md, row H13;
 * migrations/1786500000000_collaboration-operations-and-attribution.sql.
 */

import type { OwnershipTransfer as OwnershipTransferResource } from '@verdery/api-contracts';
import { CollaborationErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import {
  ConflictError,
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  assertRecentAuthenticationForOwnershipAdministration,
  beginOwnershipTransfer,
} from '../domain/ownership-transfer.js';
import type {
  OwnershipAdministrationActor,
  OwnershipTransferResultingRole,
} from '../domain/ownership-transfer.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toOwnershipTransferResource } from './ownership-transfer-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'ownership_transfer.request';
const PENDING_TRANSFER_CONSTRAINT = 'ownership_transfer_pending_key';

function membershipNotFound(): NotFoundError {
  return new NotFoundError(
    CollaborationErrorCode.MembershipNotFound,
    'No active membership exists for this profile on this garden.',
  );
}

function alreadyPending(): ConflictError {
  return new ConflictError(
    CollaborationErrorCode.OwnershipTransferAlreadyPending,
    'A pending ownership transfer already exists for this garden.',
  );
}

export class TransferOwnership {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    toProfileId: Uuid,
    resultingRole: OwnershipTransferResultingRole,
    actor: OwnershipAdministrationActor,
    idempotencyKey: string,
  ): Promise<OwnershipTransferResource> {
    const fromMembership = await this.authorization.requireCapability(
      gardenId,
      actor.profileId,
      'administerOwnership',
    );
    assertRecentAuthenticationForOwnershipAdministration(actor.authenticatedAt, this.clock.now());

    if (toProfileId === actor.profileId) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        'toProfileId must name someone other than the caller.',
        {
          details: [{ code: 'ownership_transfer.to_profile_id.invalid', pointer: '/toProfileId' }],
        },
      );
    }

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, toProfileId, resultingRole }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const existingPending = await context.ownershipTransfers.findPendingForGarden(gardenId);
      if (existingPending !== null) {
        throw alreadyPending();
      }

      const target = await context.memberships.findActiveByGardenAndProfile(gardenId, toProfileId);
      if (target === null) {
        throw membershipNotFound();
      }
      if (target.role === 'owner') {
        throw new DomainRuleViolatedError(
          CollaborationErrorCode.TargetAlreadyOwner,
          'This member is already an owner. Use demote instead.',
        );
      }

      // Re-read both sides under a row lock immediately before writing —
      // see this file's header for why this closes G-15 without needing
      // `lockActiveOwnerIds`.
      const lockedTarget = await context.memberships.lockMembership(target.id);
      if (lockedTarget === null || lockedTarget.state !== 'active') {
        throw membershipNotFound();
      }
      if (lockedTarget.role === 'owner') {
        throw new DomainRuleViolatedError(
          CollaborationErrorCode.TargetAlreadyOwner,
          'This member is already an owner. Use demote instead.',
        );
      }

      const lockedFrom = await context.memberships.lockMembership(fromMembership.id);
      if (lockedFrom === null || lockedFrom.state !== 'active' || lockedFrom.role !== 'owner') {
        throw new ForbiddenError(
          SharedErrorCode.Forbidden,
          'Your ownership on this garden changed; retry the transfer.',
        );
      }

      const now = this.clock.now();
      const transfer = beginOwnershipTransfer({
        id: generateUuidV7(),
        gardenId,
        fromProfileId: actor.profileId,
        toProfileId,
        fromResultingRole: resultingRole,
        authenticatedAt: actor.authenticatedAt,
        now,
      });

      try {
        await context.ownershipTransfers.insertPending(transfer);
      } catch (error) {
        if (
          isUniqueViolation(error) &&
          postgresConstraintName(error) === PENDING_TRANSFER_CONSTRAINT
        ) {
          throw alreadyPending();
        }
        throw error;
      }

      // Audit and outbox for the REQUEST, not a completion — nothing about
      // either membership has changed yet. The outbox event exists so a
      // future notification path can tell the recipient they have an offer
      // to act on; that path is not this work package's to build, but the
      // event is the same "durable fact of what happened" every other
      // command in this module already emits.
      await context.auditLogger.record({
        eventType: 'ownership_transfer.requested',
        subjectType: 'ownership_transfer',
        subjectId: transfer.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId,
        details: { toProfileId, fromResultingRole: resultingRole },
      });
      await context.outbox.append({
        eventType: 'ownership_transfer.requested',
        aggregateType: 'ownership_transfer',
        aggregateId: transfer.id,
        payload: {
          gardenId,
          fromProfileId: actor.profileId,
          toProfileId,
          fromResultingRole: resultingRole,
        },
      });

      return toOwnershipTransferResource(transfer);
    });
  }
}
