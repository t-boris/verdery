/**
 * Revokes a profile's publisher access on an engagement (P9C-PUBLISH-01).
 *
 * Same dual authorization gate as `GrantPublisherAccess` — see that file's
 * own header for why reusing `requireEngagementCapability` unchanged is the
 * correct posture rather than a shortcut.
 *
 * IDEMPOTENT ACROSS THREE OUTCOMES, distinguished by
 * `findLatestByEngagementAndProfile` (the most recent grant regardless of
 * state, not only the active one): no grant ever existed at all -> `404`;
 * the most recent grant is already `revoked` -> `200`, returned unchanged;
 * the most recent grant is `active` -> revoke it. This mirrors
 * `EndGardenAssignment`'s own "decide under lock" shape, adapted for a
 * two-state (not three-state) machine with no cross-terminal case to guard
 * against — see `publisher-grant-repository.ts`'s own header.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01.
 */

import type { PublisherGrant as PublisherGrantResource } from '@verdery/api-contracts';
import { PublisherGrantErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { toPublisherGrantResource } from './publisher-grant-view.js';
import { requireEngagementCapability } from './require-engagement-capability.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.publishers.revoke';

function grantNotFound(): NotFoundError {
  return new NotFoundError(
    PublisherGrantErrorCode.NotFound,
    'No publisher grant exists for this profile on this engagement.',
  );
}

export class RevokePublisherAccess {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardenAuthorization: GardenAuthorization,
    private readonly engagements: ClientEngagementRepository,
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

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, targetProfileId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const latest = await context.publisherGrants.findLatestByEngagementAndProfile(
        engagementId,
        targetProfileId,
      );
      if (latest === null) {
        throw grantNotFound();
      }

      const locked = await context.publisherGrants.lockById(latest.id);
      if (locked === null) {
        throw grantNotFound();
      }

      if (locked.state === 'revoked') {
        // Idempotent no-op: already revoked.
        return toPublisherGrantResource(locked);
      }

      const now = this.clock.now();
      await context.publisherGrants.revoke(locked.id, now, actorProfileId);

      await context.auditLogger.record({
        eventType: 'publisher_grant.revoked',
        subjectType: 'publisher_grant',
        subjectId: locked.id,
        actorProfileId,
        actorType: 'user',
        gardenId: engagement.gardenId,
        details: { engagementId, profileId: targetProfileId },
      });
      await context.outbox.append({
        eventType: 'publisher_grant.revoked',
        aggregateType: 'publisher_grant',
        aggregateId: locked.id,
        payload: { engagementId, profileId: targetProfileId },
      });

      return toPublisherGrantResource({
        ...locked,
        state: 'revoked',
        revokedAt: now,
        revokedByProfileId: actorProfileId,
      });
    });
  }
}
