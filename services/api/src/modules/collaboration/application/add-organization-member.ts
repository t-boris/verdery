/**
 * Adds an EXISTING profile as an organization member (P9B-API-01).
 *
 * `manageOrganizationMembership`-only. NO INVITATION-WITH-TOKEN FLOW: unlike
 * a garden invitation (which must reach someone with no prior relationship
 * to the garden, often before they have ever heard of it) or a future
 * client invitation (P9C-INVITE-01, which must bind and verify an external
 * client's email address they do not yet have an account against), adding
 * an organization member is an admin picking a colleague they already know
 * by their existing profile id — an ordinary, already-authenticated
 * relationship with no unverified-identity problem to solve. Building a
 * token/email/expiry mechanism here would duplicate machinery this package
 * genuinely does not need, the exact judgment call
 * implementation-plan.md work package P9B-API-01 itself calls for.
 *
 * `collaboration.organization_membership` has NO invitation-shaped
 * "unbound, shareable" mode either way: `profileId` names a real,
 * already-provisioned profile, checked against `identity_access.profile`
 * before ever attempting the insert.
 *
 * Refused with `409` when the named profile already has ANY membership row
 * (active or removed) on this organization — `organization_membership_
 * org_profile_key`'s own "one row per (organization, profile) forever"
 * constraint (the migration's own comment) means a removed member cannot
 * currently be re-added; this command never attempts to reactivate one. The
 * conflict is checked twice, deliberately, mirroring
 * `gardens-mapping/application/create-invitation.ts`'s own dual guard: a
 * pre-check for the ordinary case's clean error, and the database's own
 * unique constraint for the genuine concurrent race the pre-check cannot
 * see.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "7. Service Organizations and Assignments".
 */

import type { OrganizationMember } from '@verdery/api-contracts';
import { OrganizationErrorCode } from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import { ConflictError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { ProfileRepository } from '../../identity-access/public.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { OrganizationRole } from '../domain/organization-role.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { toOrganizationMemberResource } from './organization-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'organizations.members.add';
const MEMBERSHIP_CONSTRAINT = 'organization_membership_org_profile_key';

function membershipAlreadyExists(cause?: unknown): ConflictError {
  return new ConflictError(
    OrganizationErrorCode.MembershipAlreadyExists,
    'This profile already has a membership record on this organization.',
    cause === undefined ? {} : { cause },
  );
}

export class AddOrganizationMember {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly authorization: OrganizationAuthorization,
    private readonly profiles: ProfileRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    organizationId: Uuid,
    targetProfileId: Uuid,
    role: OrganizationRole,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<OrganizationMember> {
    await this.authorization.requireCapability(
      organizationId,
      actorProfileId,
      'manageOrganizationMembership',
    );

    const profile = await this.profiles.findById(targetProfileId);
    if (profile === null) {
      throw new NotFoundError(
        OrganizationErrorCode.ProfileNotFound,
        'No profile exists at this id.',
      );
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ organizationId, targetProfileId, role }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const existing = await context.organizationMemberships.findByOrganizationAndProfile(
        organizationId,
        targetProfileId,
      );
      if (existing !== null) {
        throw membershipAlreadyExists();
      }

      const now = this.clock.now();
      const membershipId = generateUuidV7();

      try {
        await context.organizationMemberships.insert(
          membershipId,
          organizationId,
          targetProfileId,
          role,
          now,
        );
      } catch (error) {
        if (isUniqueViolation(error) && postgresConstraintName(error) === MEMBERSHIP_CONSTRAINT) {
          throw membershipAlreadyExists(error);
        }
        throw error;
      }

      await context.organizationMemberships.openPeriod({
        id: generateUuidV7(),
        membershipId,
        organizationId,
        profileId: targetProfileId,
        role,
        validFrom: now,
      });

      await context.auditLogger.record({
        eventType: 'organization.member_added',
        subjectType: 'organization_membership',
        subjectId: membershipId,
        actorProfileId,
        actorType: 'user',
        details: { organizationId, targetProfileId, role },
      });
      await context.outbox.append({
        eventType: 'organization.member_added',
        aggregateType: 'organization_membership',
        aggregateId: membershipId,
        payload: { organizationId, profileId: targetProfileId, role },
      });

      return toOrganizationMemberResource({
        id: membershipId,
        organizationId,
        profileId: targetProfileId,
        role,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      });
    });
  }
}
