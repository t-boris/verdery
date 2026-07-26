/**
 * Removes a member from a garden, or lets a member remove themselves
 * (P9A-API-01).
 *
 * ONE command for both H11 ("Remove another member" — owner-only) and H12
 * ("Remove oneself" — every role, S3: "self-removal is not membership
 * administration") because they differ only in which capability gate
 * applies, and the last-owner hazard is identical either way: a sole owner
 * removing themselves is exactly as dangerous as an owner removing their
 * only co-owner. `manageGarden` is required UNLESS the caller is removing
 * themselves.
 *
 * THE TARGET ROW IS ALWAYS LOCKED FIRST (`lockMembership`), even when
 * removing a non-owner — a real bug fixed after shipping, not a style
 * choice. The original version decided whether the last-owner check applied
 * from an UNLOCKED read, and only locked at all once it already believed the
 * target was an owner. That read a stale snapshot: a concurrent role change
 * on the SAME row (accepting an ownership transfer, a promotion) could turn
 * this membership into the garden's sole owner between the unlocked read
 * and this transaction's write, and the removal would go through with no
 * last-owner check ever having run, because the decision was made before
 * the role changed. A real-Postgres concurrency test caught this exact
 * interleaving (`collaboration-ownership-transfer-decline.test.ts`,
 * "acceptance racing the recipient's own self-removal") — both the accept
 * and the removal committed successfully, leaving the garden owned by
 * someone whose membership had just been marked `removed`. Locking the
 * target row up front, THEN deciding, closes it: whichever of the two
 * commands acquires the lock first, the other blocks and re-reads the
 * CURRENT role once unblocked, exactly like every other owner-set-shrinking
 * command in this module (`accept-ownership-transfer.ts`,
 * `promote-to-owner.ts`, `demote-owner.ts`, `transfer-ownership.ts`).
 *
 * THE LAST-OWNER LOCK proper, run exactly when the migration's own comment
 * prescribes it — "any command that removes or demotes an owner", not
 * every call to this function: `lockActiveOwnerIds` only runs when the
 * TARGET's (locked) current role is `owner`. Removing a non-owner member
 * can never shrink the owner set, so locking the OTHER owner rows for that
 * case would be pure overhead with no invariant behind it — the target's
 * OWN row is still locked either way, by the paragraph above.
 * `FOR UPDATE ... ORDER BY id` runs, and its result is inspected, BEFORE
 * the removal write — the exact sequencing the migration's comment requires
 * so a concurrent second
 * removal blocks instead of reading a stale owner count.
 *
 * Source: implementation-plan.md work package P9A-API-01;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer";
 * migrations/1786500000000_collaboration-operations-and-attribution.sql
 * (the last-owner comment); docs/development/garden-capability-matrix.md,
 * rows H11, H12.
 *
 * THE REVOCATION TOMBSTONE (P9A-SYNC-01): the ordinary "kick this person off
 * the garden" case had no producer of the offline-synchronization revocation
 * signal until now — `garden-membership-revocation.ts`'s `revokeGardenMemberships`
 * only ever runs from garden deletion. This command writes the SAME shape
 * that function does (a `garden` record, `operation: 'delete'`, addressed via
 * `target_profile_id` so only the removed member's own client discards it —
 * architecture/offline-synchronization.md, section "11.1 Implemented
 * revocation profile"), not a second mechanism. Self-removal (H12) reaches
 * this exact same line: `targetProfileId === actorProfileId` in that case,
 * and the tombstone is addressed to the caller's own next pull, which is
 * correct — a member who just removed themselves must also learn it from
 * sync, not only from this call's own response.
 */

import type { GardenMember } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  InternalError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenMemberResource } from './membership-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'members.remove';

export class RemoveMember {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    targetProfileId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<GardenMember> {
    // `viewGarden`, not `manageGarden`: this call must succeed for the
    // concealment check and the self-removal case alike (a viewer removing
    // themselves holds no administrative capability at all). The narrower
    // `manageGarden` gate below applies only when the target is someone
    // else.
    await this.authorization.requireCapability(gardenId, actorProfileId, 'viewGarden');

    const isSelf = targetProfileId === actorProfileId;
    if (!isSelf) {
      await this.authorization.requireCapability(gardenId, actorProfileId, 'manageGarden');
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, targetProfileId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const initialLookup = await context.memberships.findActiveByGardenAndProfile(
        gardenId,
        targetProfileId,
      );
      if (initialLookup === null) {
        throw new NotFoundError(
          CollaborationErrorCode.MembershipNotFound,
          'No active membership exists for this profile on this garden.',
        );
      }

      // Re-read under lock before deciding anything: `initialLookup` above
      // resolves the row's id only. Branching the last-owner check on THAT
      // unlocked snapshot is unsafe — a concurrent role change (accepting an
      // ownership transfer, a promotion) can turn this membership into the
      // garden's sole owner between the read above and this transaction's
      // write, and a decision made before that change would never see it,
      // letting a removal strip the garden's only owner with the last-owner
      // protection never running. `lockMembership` forces the same
      // serialization every other owner-set-shrinking command in this module
      // already relies on (`accept-ownership-transfer.ts`,
      // `promote-to-owner.ts`, `demote-owner.ts`, `transfer-ownership.ts`).
      const target = await context.memberships.lockMembership(initialLookup.id);
      if (target === null || target.state !== 'active') {
        throw new NotFoundError(
          CollaborationErrorCode.MembershipNotFound,
          'No active membership exists for this profile on this garden.',
        );
      }

      if (target.role === 'owner') {
        const lockedOwnerIds = await context.memberships.lockActiveOwnerIds(gardenId);
        const remainingOwners = lockedOwnerIds.filter((id) => id !== target.id);
        if (remainingOwners.length === 0) {
          throw new DomainRuleViolatedError(
            CollaborationErrorCode.LastOwnerRequired,
            'A garden must always have at least one active owner.',
          );
        }
      }

      const now = this.clock.now();
      await context.memberships.closeOpenPeriod(target.id, now, 'removed');
      await context.memberships.setState(target.id, 'removed', now);

      const garden = await context.gardens.findById(gardenId);
      if (garden === null) {
        // Unreachable in practice: the active-membership lookup above already
        // established this garden exists — a membership row only outlives its
        // garden after a PURGE, which itself revokes every membership first
        // (`garden-membership-revocation.ts`), so no ACTIVE membership could
        // reach this point once its garden is gone. An honest internal error
        // is more truthful than writing a tombstone with a fabricated revision.
        throw new InternalError(
          'gardens.members.remove.garden_missing',
          'The garden for an active membership could not be found.',
        );
      }
      await context.syncChanges.record({
        gardenId: garden.id,
        recordId: garden.id,
        recordType: 'garden',
        operation: 'delete',
        recordRevision: garden.revision,
        targetProfileId,
      });

      await context.auditLogger.record({
        eventType: 'membership.removed',
        subjectType: 'membership',
        subjectId: target.id,
        actorProfileId,
        actorType: 'user',
        gardenId,
        details: { targetProfileId, role: target.role, removedBySelf: isSelf },
      });
      await context.outbox.append({
        eventType: 'membership.removed',
        aggregateType: 'membership',
        aggregateId: target.id,
        payload: { gardenId, profileId: targetProfileId, role: target.role },
      });

      return toGardenMemberResource({ ...target, state: 'removed', updatedAt: now });
    });
  }
}
