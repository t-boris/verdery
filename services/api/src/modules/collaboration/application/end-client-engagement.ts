/**
 * Ends an `active` client engagement (P9B-API-01) — see
 * `activate-client-engagement.ts`'s own header for the shared dual
 * authorization gate, the read-then-authorize ordering, and the
 * no-revision-column lock-then-decide concurrency reasoning, all identical
 * here.
 *
 * IDEMPOTENT when already `ended`. Refused with `422` from `draft` (never
 * activated) or `revoked` (a different terminal state).
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "8. Client Engagement".
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

const OPERATION = 'client_engagements.end';
const TARGET_STATE = 'ended';

function engagementNotFound(): NotFoundError {
  return new NotFoundError(ClientEngagementErrorCode.NotFound, 'No engagement exists at this id.');
}

export class EndClientEngagement {
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
    idempotencyKey: string,
  ): Promise<ClientEngagementResource> {
    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId }),
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
        // Idempotent no-op: already ended.
        return toClientEngagementResource(locked);
      }
      if (!isValidClientEngagementTransition(locked.state, TARGET_STATE)) {
        throw new DomainRuleViolatedError(
          ClientEngagementErrorCode.InvalidTransition,
          `Cannot end an engagement in state "${locked.state}".`,
        );
      }

      const now = this.clock.now();
      await context.clientEngagements.end(locked.id, now);

      await context.auditLogger.record({
        eventType: 'client_engagement.ended',
        subjectType: 'client_engagement',
        subjectId: locked.id,
        actorProfileId,
        actorType: 'user',
        gardenId: locked.gardenId,
        details: { serviceOrganizationId: locked.serviceOrganizationId },
      });
      await context.outbox.append({
        eventType: 'client_engagement.ended',
        aggregateType: 'client_engagement',
        aggregateId: locked.id,
        payload: { gardenId: locked.gardenId, serviceOrganizationId: locked.serviceOrganizationId },
      });

      return toClientEngagementResource({
        ...locked,
        state: TARGET_STATE,
        endedAt: now,
        updatedAt: now,
      });
    });
  }
}
