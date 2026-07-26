/**
 * Promotes an active `editor`/`viewer` member to co-owner (P9A-OWNER-01,
 * matrix row H8) — the ONLY path from an accepted ordinary invitation to
 * co-ownership, since `createInvitation` can never name `owner`
 * (`invitation_intended_role_check`; identity-and-authorization.md section
 * "10. Invitations").
 *
 * Owner-only (`administerOwnership`) plus a RECENT authentication
 * (`assertRecentAuthenticationForOwnershipAdministration`) — section 11's
 * two authentication preconditions, the same two-check layering
 * `RequestGardenDeletion` already established for `manageGarden` plus
 * `assertRecentAuthenticationForDeletion`.
 *
 * SAME PERIOD SHAPE AS `ChangeMemberRole`: close the target's open
 * `membership_period` with `ended_reason = 'role_changed'` and open a new
 * one at `owner` — a role change on this membership row is a role change,
 * regardless of which two roles it moves between. Nothing about becoming an
 * owner is a different KIND of transition than editor-to-viewer; a distinct
 * `ownership_transfer` row exists only for the case where a SECOND
 * membership's role changes at the same time, together — see
 * `domain/ownership-transfer.ts`'s header. Promotion touches exactly one
 * membership, so it is exactly one role change.
 *
 * WHY THIS COMMAND DOES NOT RUN THE LAST-OWNER LOCK, checked with the same
 * rigor `RemoveMember`'s own header applies to its non-owner-target case:
 * promotion can only ever ADD a row to the active-owner set (the target's
 * role moves FROM `editor`/`viewer` TO `owner`; the no-op branch below
 * refuses even to attempt the write when the target is already `owner`).
 * There is no execution of this function, concurrent or not, that can
 * REMOVE a garden's owner — the hazard `lockActiveOwnerIds` exists for does
 * not arise. `lockMembership` still runs on the target's own row, for a
 * different and narrower reason: to close gap G-15 (`garden-capability-
 * matrix.md`) for this row by re-reading the target under a row lock
 * immediately before writing, so a concurrent removal or role change of the
 * SAME target cannot be silently overwritten by a stale promotion.
 *
 * Source: implementation-plan.md work package P9A-OWNER-01;
 * architecture/identity-and-authorization.md, sections "10. Invitations",
 * "11. Ownership Transfer"; docs/development/garden-capability-matrix.md,
 * row H8.
 */

import type { GardenMember } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { assertRecentAuthenticationForOwnershipAdministration } from '../domain/ownership-transfer.js';
import type { OwnershipAdministrationActor } from '../domain/ownership-transfer.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toGardenMemberResource } from './membership-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'members.promote_to_owner';

function membershipNotFound(): NotFoundError {
  return new NotFoundError(
    CollaborationErrorCode.MembershipNotFound,
    'No active membership exists for this profile on this garden.',
  );
}

export class PromoteToOwner {
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
    idempotencyKey: string,
  ): Promise<GardenMember> {
    await this.authorization.requireCapability(gardenId, actor.profileId, 'administerOwnership');
    assertRecentAuthenticationForOwnershipAdministration(actor.authenticatedAt, this.clock.now());

    const input = {
      actorProfileId: actor.profileId,
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
        throw membershipNotFound();
      }
      if (target.role === 'owner') {
        // No-op: already owner. Returned unchanged rather than closing and
        // reopening an identical period for no reason (the same posture
        // `ChangeMemberRole` takes for `target.role === newRole`).
        return toGardenMemberResource(target);
      }

      // Re-read under a row lock immediately before writing: closes G-15 for
      // this row. A concurrent removal or role change of the SAME target
      // between the read above and this lock is caught here rather than
      // silently overwritten.
      const locked = await context.memberships.lockMembership(target.id);
      if (locked === null || locked.state !== 'active') {
        throw membershipNotFound();
      }
      if (locked.role === 'owner') {
        return toGardenMemberResource(locked);
      }

      const now = this.clock.now();
      await context.memberships.closeOpenPeriod(target.id, now, 'role_changed');
      await context.memberships.changeRole(target.id, 'owner', now);
      await context.memberships.openPeriod({
        id: generateUuidV7(),
        membershipId: target.id,
        gardenId,
        profileId: targetProfileId,
        role: 'owner',
        validFrom: now,
      });

      await context.auditLogger.record({
        eventType: 'membership.owner_promoted',
        subjectType: 'membership',
        subjectId: target.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId,
        details: { targetProfileId, previousRole: locked.role },
      });
      await context.outbox.append({
        eventType: 'membership.owner_promoted',
        aggregateType: 'membership',
        aggregateId: target.id,
        payload: { gardenId, profileId: targetProfileId, previousRole: locked.role },
      });

      return toGardenMemberResource({ ...locked, role: 'owner', updatedAt: now });
    });
  }
}
