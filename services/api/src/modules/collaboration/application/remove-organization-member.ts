/**
 * Removes a member from an organization, or lets a member remove themselves
 * (P9B-API-01) — mirrors `gardens-mapping/application/remove-member.ts`
 * structurally: ONE command for both "remove another member"
 * (`manageOrganizationMembership`-gated) and "remove oneself" (leaving an
 * organization is not organization administration), because they differ
 * only in which capability gate applies, and the last-admin hazard is
 * identical either way.
 *
 * THE TARGET ROW IS ALWAYS LOCKED FIRST, even when removing a non-admin —
 * the identical real-bug-fixed-after-shipping reasoning `RemoveMember`'s own
 * header documents in detail: deciding whether the last-admin check applies
 * from an UNLOCKED read is unsafe, because a concurrent role change on the
 * SAME row (a promotion to `organization_admin`) could turn this membership
 * into the target between the unlocked read and this transaction's write.
 * Locking the target row up front, THEN deciding, closes it exactly the same
 * way.
 *
 * THE LAST-ADMIN LOCK proper runs exactly when the target's (locked) current
 * role is `organization_admin` — removing a `professional` can never shrink
 * the active-admin set, so locking every other admin row for that case
 * would be pure overhead with no invariant behind it, the identical
 * reasoning `RemoveMember`'s own header applies to non-owner targets.
 *
 * NO OFFLINE-SYNC REVOCATION TOMBSTONE is written here, unlike
 * `RemoveMember`: organizations have no offline garden-partition sync
 * protocol of their own to notify (architecture/offline-synchronization.md
 * describes only the garden partition), so there is no equivalent signal
 * for this command to produce.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * migrations/1786600000000_service-organizations-and-client-engagements.sql.
 */

import type { OrganizationMember } from '@verdery/api-contracts';
import { OrganizationErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { toOrganizationMemberResource } from './organization-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'organizations.members.remove';

function membershipNotFound(): NotFoundError {
  return new NotFoundError(
    OrganizationErrorCode.MembershipNotFound,
    'No active membership exists for this profile on this organization.',
  );
}

export class RemoveOrganizationMember {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly authorization: OrganizationAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    organizationId: Uuid,
    targetProfileId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<OrganizationMember> {
    // Establishes only that the caller has SOME visibility into this
    // organization — the same "must succeed for the concealment check and
    // the self-removal case alike" reasoning `RemoveMember`'s own
    // `viewGarden` call documents.
    await this.authorization.requireActiveMembership(organizationId, actorProfileId);

    const isSelf = targetProfileId === actorProfileId;
    if (!isSelf) {
      await this.authorization.requireCapability(
        organizationId,
        actorProfileId,
        'manageOrganizationMembership',
      );
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ organizationId, targetProfileId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const initialLookup =
        await context.organizationMemberships.findActiveByOrganizationAndProfile(
          organizationId,
          targetProfileId,
        );
      if (initialLookup === null) {
        throw membershipNotFound();
      }

      // Re-read under lock before deciding anything — see this file's
      // header for why an unlocked decision is unsafe.
      const target = await context.organizationMemberships.lockMembership(initialLookup.id);
      if (target === null || target.state !== 'active') {
        throw membershipNotFound();
      }

      if (target.role === 'organization_admin') {
        const lockedAdminIds =
          await context.organizationMemberships.lockActiveAdminIds(organizationId);
        const remainingAdmins = lockedAdminIds.filter((id) => id !== target.id);
        if (remainingAdmins.length === 0) {
          throw new DomainRuleViolatedError(
            OrganizationErrorCode.LastAdminRequired,
            'An organization must always have at least one active administrator.',
          );
        }
      }

      const now = this.clock.now();
      await context.organizationMemberships.closeOpenPeriod(target.id, now, 'removed');
      await context.organizationMemberships.setState(target.id, 'removed', now);

      await context.auditLogger.record({
        eventType: 'organization.member_removed',
        subjectType: 'organization_membership',
        subjectId: target.id,
        actorProfileId,
        actorType: 'user',
        details: { organizationId, targetProfileId, role: target.role, removedBySelf: isSelf },
      });
      await context.outbox.append({
        eventType: 'organization.member_removed',
        aggregateType: 'organization_membership',
        aggregateId: target.id,
        payload: { organizationId, profileId: targetProfileId, role: target.role },
      });

      return toOrganizationMemberResource({ ...target, state: 'removed', updatedAt: now });
    });
  }
}
