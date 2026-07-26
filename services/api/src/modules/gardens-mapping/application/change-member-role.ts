/**
 * Moves a non-owner member between `editor` and `viewer` (P9A-API-01).
 *
 * Owner-only (`manageGarden`, matrix row H7). Deliberately narrower than
 * "change any member's role": both the member's CURRENT role and the
 * REQUESTED role must already be `editor` or `viewer`. Promoting to, or
 * demoting from, `owner` is a separate, recent-auth-gated flow
 * (P9A-OWNER-01) this endpoint refuses outright.
 *
 * WHY THIS COMMAND DOES NOT RUN THE LAST-OWNER LOCK, having actually
 * checked rather than assumed: the P9A-DATA-01 migration's own recipe
 * ("SELECT ... FOR UPDATE") exists for any command that "removes or demotes
 * an owner". This command can do neither. The guard two lines below —
 * refusing when EITHER the stored role or the requested role is `owner` —
 * runs and throws BEFORE any write, so by the time a write could happen,
 * both roles are already known to be in {editor, viewer}. The active-owner
 * set on the garden is therefore provably unchanged by any execution of
 * this function, with or without a lock: there is no interleaving of two
 * concurrent calls to THIS command that can empty it, because neither call
 * ever touches an owner row. (Two concurrent calls targeting the SAME
 * member's row can still race each other in the ordinary "last write wins"
 * sense `RemoveMember`'s row-level lock also does not fully eliminate for
 * non-owner targets — see that file. That is a lost-update risk, not a
 * last-owner risk, and this codebase does not yet expose optimistic
 * concurrency on `collaboration.membership` at all — gap G-15 in the
 * capability matrix, out of scope here.)
 *
 * Source: implementation-plan.md work package P9A-API-01;
 * docs/development/garden-capability-matrix.md, row H7.
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
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenMemberResource } from './membership-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'members.change_role';

function ownerRoleNotAllowed(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    CollaborationErrorCode.OwnerRoleNotAllowed,
    'Changing an owner requires the ownership transfer flow, not this endpoint.',
  );
}

export class ChangeMemberRole {
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
    newRole: InvitationRole,
    idempotencyKey: string,
  ): Promise<GardenMember> {
    await this.authorization.requireCapability(gardenId, actorProfileId, 'manageGarden');

    const input = {
      actorProfileId,
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
      if (target.role === 'owner') {
        throw ownerRoleNotAllowed();
      }

      if (target.role === newRole) {
        // No-op: already the requested role. Returned unchanged rather than
        // closing and reopening an identical period for no reason.
        return toGardenMemberResource(target);
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
        eventType: 'membership.role_changed',
        subjectType: 'membership',
        subjectId: target.id,
        actorProfileId,
        actorType: 'user',
        gardenId,
        details: { targetProfileId, previousRole: target.role, newRole },
      });
      await context.outbox.append({
        eventType: 'membership.role_changed',
        aggregateType: 'membership',
        aggregateId: target.id,
        payload: { gardenId, profileId: targetProfileId, previousRole: target.role, newRole },
      });

      return toGardenMemberResource({ ...target, role: newRole, updatedAt: now });
    });
  }
}
