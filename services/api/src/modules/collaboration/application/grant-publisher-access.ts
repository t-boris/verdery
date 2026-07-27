/**
 * Grants the SEPARATE publisher capability on an engagement (P9C-PUBLISH-01)
 * — ADR-0012, "Publication Boundary": "An organization administrator grants
 * it for an organization-backed engagement; a garden owner grants it when
 * no service organization is attached."
 *
 * AUTHORIZATION TO GRANT reuses `requireEngagementCapability` UNCHANGED —
 * the identical dual gate `ActivateClientEngagement`/`CreateClientEngagement`
 * already apply, re-evaluated against the engagement's CURRENT
 * `serviceOrganizationId` (never a client-supplied value), exactly like
 * those commands. This is deliberate, not a shortcut: "who administers the
 * engagement record" and "who may grant publisher access on it" are the
 * SAME question per the ADR's own wording — the capability being GRANTED
 * (publish) is what stays separate from `manageEngagement`, not the
 * authority to grant it.
 *
 * GRANTEE ELIGIBILITY is a second, independent check this command adds: an
 * organization-backed grant requires the named profile be an ACTIVE member
 * of THAT SAME organization (mirroring `CreateGardenAssignment`'s identical
 * assignee check — an org admin of org A can never grant publisher access
 * to a stranger with no relationship to org A); a no-organization grant
 * requires the named profile hold ACTIVE garden membership (any role) on
 * the engagement's own garden, translated the same way `AssignTask`
 * translates an ineligible-assignee lookup failure into a domain error
 * rather than the caller's own `forbidden`.
 *
 * Refused with `409` when the named profile already holds an ACTIVE grant
 * on this engagement (`publisher_grant_active_key`) — checked twice,
 * deliberately, the same dual pre-check-plus-catch pattern
 * `CreateGardenAssignment`/`AddOrganizationMember` already establish.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Publication Boundary".
 */

import type { PublisherGrant as PublisherGrantResource } from '@verdery/api-contracts';
import { PublisherGrantErrorCode } from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import {
  ConflictError,
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import type { OrganizationMembershipRepository } from './organization-membership-repository.js';
import { toPublisherGrantResource } from './publisher-grant-view.js';
import { requireEngagementCapability } from './require-engagement-capability.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.publishers.grant';
const ACTIVE_GRANT_CONSTRAINT = 'publisher_grant_active_key';

function alreadyActive(cause?: unknown): ConflictError {
  return new ConflictError(
    PublisherGrantErrorCode.AlreadyActive,
    'This profile already holds an active publisher grant on this engagement.',
    cause === undefined ? {} : { cause },
  );
}

export class GrantPublisherAccess {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardenAuthorization: GardenAuthorization,
    private readonly engagements: ClientEngagementRepository,
    private readonly organizationMemberships: OrganizationMembershipRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    engagementId: Uuid,
    targetProfileId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<PublisherGrantResource> {
    const engagement = await this.engagements.findById(engagementId);
    if (engagement === null) {
      throw engagementNotFoundError();
    }

    await requireEngagementCapability(
      engagement,
      actorProfileId,
      this.organizationAuthorization,
      this.gardenAuthorization,
    );

    if (engagement.serviceOrganizationId !== null) {
      const membership = await this.organizationMemberships.findActiveByOrganizationAndProfile(
        engagement.serviceOrganizationId,
        targetProfileId,
      );
      if (membership === null) {
        throw new DomainRuleViolatedError(
          PublisherGrantErrorCode.GranteeNotOrganizationMember,
          'The grantee must be an active member of this engagement’s own organization.',
        );
      }
    } else {
      try {
        await this.gardenAuthorization.requireCapability(
          engagement.gardenId,
          targetProfileId,
          'viewGarden',
        );
      } catch (error) {
        if (error instanceof NotFoundError || error instanceof ForbiddenError) {
          throw new DomainRuleViolatedError(
            PublisherGrantErrorCode.GranteeNotGardenMember,
            'The grantee must hold active membership on this engagement’s own garden.',
          );
        }
        throw error;
      }
    }

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, targetProfileId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      const alreadyGranted = await context.publisherGrants.findActiveByEngagementAndProfile(
        engagementId,
        targetProfileId,
      );
      if (alreadyGranted !== null) {
        throw alreadyActive();
      }

      const now = this.clock.now();
      const id = generateUuidV7();

      try {
        await context.publisherGrants.insert({
          id,
          engagementId,
          profileId: targetProfileId,
          grantedByProfileId: actorProfileId,
          now,
        });
      } catch (error) {
        if (isUniqueViolation(error) && postgresConstraintName(error) === ACTIVE_GRANT_CONSTRAINT) {
          throw alreadyActive(error);
        }
        throw error;
      }

      await context.auditLogger.record({
        eventType: 'publisher_grant.granted',
        subjectType: 'publisher_grant',
        subjectId: id,
        actorProfileId,
        actorType: 'user',
        gardenId: engagement.gardenId,
        details: { engagementId, profileId: targetProfileId },
      });
      await context.outbox.append({
        eventType: 'publisher_grant.granted',
        aggregateType: 'publisher_grant',
        aggregateId: id,
        payload: { engagementId, profileId: targetProfileId },
      });

      return toPublisherGrantResource({
        id,
        engagementId,
        profileId: targetProfileId,
        state: 'active',
        grantedByProfileId: actorProfileId,
        grantedAt: now,
        revokedAt: null,
        revokedByProfileId: null,
        createdAt: now,
      });
    });
  }
}
