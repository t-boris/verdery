/**
 * Demotes an active owner to `editor`/`viewer`, as long as at least one
 * OTHER active owner remains (P9A-OWNER-01, matrix row H9) — precisely the
 * hazard `lockActiveOwnerIds` exists for
 * (migrations/1786500000000_collaboration-operations-and-attribution.sql's
 * own comment: "any command that removes or demotes an owner"). Unlike
 * `PromoteToOwner`, this command CAN shrink the active-owner set, so it runs
 * the lock unconditionally once the target is confirmed to be an owner.
 *
 * Owner-only (`administerOwnership`) plus a RECENT authentication, exactly
 * like `PromoteToOwner` and `TransferOwnership`.
 *
 * `lockActiveOwnerIds` locks every currently-active owner ROW on the garden,
 * `FOR UPDATE`, ORDER BY id — which is why a second `lockMembership` call on
 * the target specifically would be redundant here (unlike `PromoteToOwner`,
 * whose target is never among the locked rows): the target, being an owner,
 * is already one of the rows this lock holds. Two concurrent demotions on
 * the same garden therefore serialize on the SAME lock set in the SAME
 * order, which is what makes the second transaction re-evaluate the
 * predicate against the first's committed result rather than a stale
 * snapshot — see `tests/migrations/collaboration-assignment-and-last-owner
 * .test.ts` for the proof this recipe is built from, and
 * `tests/integration/collaboration-ownership.test.ts` for the same proof
 * against this command specifically.
 *
 * Self-targeting is permitted: matrix row H9 does not distinguish "another
 * owner demotes me" from "I demote myself while a co-owner remains" — both
 * require the SAME capability and the SAME remaining-owner guarantee, unlike
 * `RemoveMember`'s H11/H12 split (which differs in which capability applies,
 * not in the last-owner hazard).
 *
 * KNOWN LIMITATION, stated rather than silently worked around: a SELF-demotion
 * is not safely retryable by its own `Idempotency-Key` after it has already
 * succeeded. `requireCapability` runs BEFORE the idempotency check (the same
 * order every command in this module uses), and a successful self-demotion
 * removes the very capability the retried request needs to pass that check —
 * so a client retry after a dropped response gets `403`, not the cached `200`.
 * This is not new to this command: `RemoveMember`'s own self-removal path has
 * the identical shape (a successful self-removal makes the caller's own
 * membership invisible to a retry). Reordering authorization and idempotency
 * globally is an architecture change spanning every command in this module,
 * not a decision one work package makes unilaterally — recorded here rather
 * than patched locally. Demoting ANOTHER owner has no such gap: the actor
 * keeps `administerOwnership` after the target is demoted, so that retry path
 * replays cleanly, and is what `collaboration-ownership.test.ts` exercises.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer";
 * docs/development/garden-capability-matrix.md, rows H9, H10.
 */

import type { GardenMember } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { InvitationRole } from '../domain/invitation.js';
import { assertRecentAuthenticationForOwnershipAdministration } from '../domain/ownership-transfer.js';
import type { OwnershipAdministrationActor } from '../domain/ownership-transfer.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenMemberResource } from './membership-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'members.demote_owner';

export class DemoteOwner {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    targetProfileId: Uuid,
    actor: OwnershipAdministrationActor,
    newRole: InvitationRole,
    idempotencyKey: string,
  ): Promise<GardenMember> {
    await this.authorization.requireCapability(gardenId, actor.profileId, 'administerOwnership');
    assertRecentAuthenticationForOwnershipAdministration(actor.authenticatedAt, this.clock.now());

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, targetProfileId, newRole }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const target = await context.memberships.findActiveByGardenAndProfile(
        gardenId,
        targetProfileId,
      );
      if (target === null) {
        throw new NotFoundError(
          CollaborationErrorCode.MembershipNotFound,
          'No active membership exists for this profile on this garden.',
        );
      }
      if (target.role !== 'owner') {
        throw new DomainRuleViolatedError(
          CollaborationErrorCode.TargetNotOwner,
          'This member is not an owner.',
        );
      }

      // THE LOCK, run exactly when the migration's own comment prescribes
      // it, and inspected before any write.
      const lockedOwnerIds = await context.memberships.lockActiveOwnerIds(gardenId);
      const remainingOwners = lockedOwnerIds.filter((id) => id !== target.id);
      if (remainingOwners.length === 0) {
        throw new DomainRuleViolatedError(
          CollaborationErrorCode.LastOwnerRequired,
          'A garden must always have at least one active owner.',
        );
      }

      const now = this.clock.now();
      await context.memberships.closeOpenPeriod(target.id, now, 'role_changed');
      await context.memberships.changeRole(target.id, newRole, now);
      await context.memberships.openPeriod({
        id: generateUuidV7(),
        membershipId: target.id,
        gardenId,
        profileId: targetProfileId,
        role: newRole,
        validFrom: now,
      });

      await context.auditLogger.record({
        eventType: 'membership.owner_demoted',
        subjectType: 'membership',
        subjectId: target.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId,
        details: { targetProfileId, newRole },
      });
      await context.outbox.append({
        eventType: 'membership.owner_demoted',
        aggregateType: 'membership',
        aggregateId: target.id,
        payload: { gardenId, profileId: targetProfileId, newRole },
      });

      return toGardenMemberResource({ ...target, role: newRole, updatedAt: now });
    });
  }
}
