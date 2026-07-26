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
 * THE LAST-OWNER LOCK, run exactly when the migration's own comment
 * prescribes it — "any command that removes or demotes an owner", not
 * every call to this function: `lockActiveOwnerIds` only runs when the
 * TARGET's current role is `owner`. Removing a non-owner member can never
 * shrink the owner set, so locking the owner rows for that case would be
 * pure overhead with no invariant behind it. `FOR UPDATE ... ORDER BY id`
 * runs, and its result is inspected, BEFORE the removal write — the exact
 * sequencing the migration's comment requires so a concurrent second
 * removal blocks instead of reading a stale owner count.
 *
 * Source: implementation-plan.md work package P9A-API-01;
 * architecture/identity-and-authorization.md, section "11. Ownership Transfer";
 * migrations/1786500000000_collaboration-operations-and-attribution.sql
 * (the last-owner comment); docs/development/garden-capability-matrix.md,
 * rows H11, H12.
 */

import type { GardenMember } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
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
