/**
 * Revokes a client engagement (P9B-API-01) — see
 * `activate-client-engagement.ts`'s own header for the shared dual
 * authorization gate, the read-then-authorize ordering, and the
 * no-revision-column lock-then-decide concurrency reasoning, all identical
 * here.
 *
 * VALID FROM `draft` OR `active` — `client-engagement-state.ts`'s own
 * diagram allows both (`revoke` is the "cancel" edge from either
 * pre-terminal state). IDEMPOTENT when already `revoked`. Refused with
 * `422` from `ended` — a different terminal state.
 *
 * PROHIBITED-CONTENT FIX (P9C-OBS-01). `reason` is documented, free text
 * ("Optional free-text reason, stored as `revoked_reason`" — the contract's
 * own words) — this command's audit `details` never carries it, only
 * whether one was given (`hasReason`), the same "presence boolean, never
 * the value" convention `withdraw-client-update.ts`'s own fix and
 * `notifications.preferences_updated`'s `hasQuietHours` already establish.
 *
 * Source: implementation-plan.md work packages P9B-API-01, P9C-OBS-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "8. Client Engagement", "19. Audit and Observability".
 */

import type { ClientEngagement as ClientEngagementResource } from '@verdery/api-contracts';
import { ClientEngagementErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { isValidClientEngagementTransition } from '../domain/client-engagement-state.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { toClientEngagementResource } from './client-engagement-view.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { requireEngagementCapability } from './require-engagement-capability.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.revoke';
const TARGET_STATE = 'revoked';

function engagementNotFound(): NotFoundError {
  return new NotFoundError(ClientEngagementErrorCode.NotFound, 'No engagement exists at this id.');
}

export class RevokeClientEngagement {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardenAuthorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    engagementId: Uuid,
    actorProfileId: Uuid,
    reason: string | null,
    idempotencyKey: string,
  ): Promise<ClientEngagementResource> {
    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, reason }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const found = await context.clientEngagements.findById(engagementId);
      if (found === null) {
        throw engagementNotFound();
      }

      await requireEngagementCapability(
        found,
        actorProfileId,
        this.organizationAuthorization,
        this.gardenAuthorization,
      );

      const locked = await context.clientEngagements.lockById(found.id);
      if (locked === null) {
        throw engagementNotFound();
      }

      if (locked.state === TARGET_STATE) {
        // Idempotent no-op: already revoked.
        return toClientEngagementResource(locked);
      }
      if (!isValidClientEngagementTransition(locked.state, TARGET_STATE)) {
        throw new DomainRuleViolatedError(
          ClientEngagementErrorCode.InvalidTransition,
          `Cannot revoke an engagement in state "${locked.state}".`,
        );
      }

      const now = this.clock.now();
      await context.clientEngagements.revoke(locked.id, now, reason);

      await context.auditLogger.record({
        eventType: 'client_engagement.revoked',
        subjectType: 'client_engagement',
        subjectId: locked.id,
        actorProfileId,
        actorType: 'user',
        gardenId: locked.gardenId,
        details: {
          serviceOrganizationId: locked.serviceOrganizationId,
          hasReason: reason !== null,
        },
      });
      await context.outbox.append({
        eventType: 'client_engagement.revoked',
        aggregateType: 'client_engagement',
        aggregateId: locked.id,
        payload: { gardenId: locked.gardenId, serviceOrganizationId: locked.serviceOrganizationId },
      });

      return toClientEngagementResource({
        ...locked,
        state: TARGET_STATE,
        revokedAt: now,
        revokedReason: reason,
        updatedAt: now,
      });
    });
  }
}
