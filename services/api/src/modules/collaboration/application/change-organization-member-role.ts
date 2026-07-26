/**
 * Changes a member's role between `organization_admin` and `professional`
 * (P9B-API-01).
 *
 * `manageOrganizationMembership`-only, always — unlike garden membership's
 * `changeMemberRole`/promote-to-owner split, there is no separate
 * recent-auth-gated flow here: nothing in ADR-0012 or
 * collaboration-and-client-sharing.md asks organization administration
 * changes for a recent sign-in the way garden ownership transfer does, so
 * none is invented. Both directions (promotion to admin, demotion to
 * professional) move through this ONE command, unlike gardens where `owner`
 * is excluded from `changeMemberRole` entirely — an organization has only
 * two roles, so there is no third "administration of the role-set itself"
 * concern for a separate endpoint to own.
 *
 * THE LAST-ADMIN LOCK, run exactly when the P9B-DATA-01 migration's own
 * header prescribes it — "a future organization-administration command,"
 * substituting `organization_id`/`role = 'organization_admin'` for
 * `garden_id`/`role = 'owner'` in `MembershipRepository.lockActiveOwnerIds`'s
 * own recipe — and run ONLY on a DEMOTION away from `organization_admin`.
 * Promoting a `professional` to `organization_admin` can only ever ADD a row
 * to the active-admin set, the identical "this direction cannot shrink the
 * set, so the lock is not needed for it" reasoning
 * `gardens-mapping/application/promote-to-owner.ts`'s own header applies to
 * garden ownership.
 *
 * THE TARGET ROW IS LOCKED FIRST, in EITHER direction, mirroring
 * `PromoteToOwner`'s own "re-read under a row lock immediately before
 * writing" step: closes the identical race a stale unlocked read would
 * otherwise leave open — a concurrent removal or role change of the SAME
 * target between the read and the write.
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
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { OrganizationRole } from '../domain/organization-role.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { toOrganizationMemberResource } from './organization-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'organizations.members.change_role';

function membershipNotFound(): NotFoundError {
  return new NotFoundError(
    OrganizationErrorCode.MembershipNotFound,
    'No active membership exists for this profile on this organization.',
  );
}

function lastAdminRequired(): DomainRuleViolatedError {
  return new DomainRuleViolatedError(
    OrganizationErrorCode.LastAdminRequired,
    'An organization must always have at least one active administrator.',
  );
}

export class ChangeOrganizationMemberRole {
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
    newRole: OrganizationRole,
    idempotencyKey: string,
  ): Promise<OrganizationMember> {
    await this.authorization.requireCapability(
      organizationId,
      actorProfileId,
      'manageOrganizationMembership',
    );

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ organizationId, targetProfileId, newRole }),
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
      // header for why this applies in both directions.
      const target = await context.organizationMemberships.lockMembership(initialLookup.id);
      if (target === null || target.state !== 'active') {
        throw membershipNotFound();
      }

      if (target.role === newRole) {
        // No-op: already the requested role.
        return toOrganizationMemberResource(target);
      }

      if (target.role === 'organization_admin') {
        // Demotion away from admin: the last-admin lock, run BEFORE the
        // write, exactly as the migration's own recipe prescribes.
        const lockedAdminIds =
          await context.organizationMemberships.lockActiveAdminIds(organizationId);
        const remainingAdmins = lockedAdminIds.filter((id) => id !== target.id);
        if (remainingAdmins.length === 0) {
          throw lastAdminRequired();
        }
      }

      const now = this.clock.now();
      await context.organizationMemberships.closeOpenPeriod(target.id, now, 'role_changed');
      await context.organizationMemberships.changeRole(target.id, newRole, now);
      await context.organizationMemberships.openPeriod({
        id: generateUuidV7(),
        membershipId: target.id,
        organizationId,
        profileId: targetProfileId,
        role: newRole,
        validFrom: now,
      });

      await context.auditLogger.record({
        eventType: 'organization.member_role_changed',
        subjectType: 'organization_membership',
        subjectId: target.id,
        actorProfileId,
        actorType: 'user',
        details: { organizationId, targetProfileId, previousRole: target.role, newRole },
      });
      await context.outbox.append({
        eventType: 'organization.member_role_changed',
        aggregateType: 'organization_membership',
        aggregateId: target.id,
        payload: { organizationId, profileId: targetProfileId, previousRole: target.role, newRole },
      });

      return toOrganizationMemberResource({ ...target, role: newRole, updatedAt: now });
    });
  }
}
