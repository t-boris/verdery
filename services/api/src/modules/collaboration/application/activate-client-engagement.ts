/**
 * Activates a `draft` client engagement (P9B-API-01).
 *
 * Authorization is the shared dual gate `require-engagement-capability.ts`
 * documents in full — read that file's header before this one for why the
 * lookup happens before authorization here, unlike almost every other
 * command in this codebase.
 *
 * ENFORCES ONLY THE STATE-MACHINE TRANSITION ITSELF
 * (`client-engagement-state.ts`'s own `draft -> active` edge), exactly what
 * this package's own task scope asks for — "read the state machine, do not
 * reinvent it." The RICHER precondition
 * architecture/collaboration-and-client-sharing.md section 8 also describes
 * ("Activation requires at least one garden, one client identity or pending
 * bound invitation, and an approved stewardship policy") is only PARTIALLY
 * structural: the garden half is automatic (`client_engagement.garden_id`
 * is `NOT NULL` on every row) and the stewardship-policy half is automatic
 * (`stewardship_policy` is `NOT NULL DEFAULT 'residential'`), matching the
 * P9B-DATA-01 migration's own header — but the CLIENT half genuinely is
 * NOT enforced here: nothing in this package's scope creates a
 * `client_access_grant` row (no command in the "What to build" list for
 * P9B-API-01 does), so there is no client identity or pending invitation
 * for this command to check for, and it does not invent one. That
 * mechanism belongs to P9C-INVITE-01 ("implement email-bound, expiring
 * client invitations"), which is expected to tighten this endpoint's own
 * precondition once a real grant can exist. Documented here rather than
 * silently assumed — the same honesty the underlying migration's own header
 * applies to every invariant it does not enforce.
 *
 * IDEMPOTENT when already `active`. Refused with `422` from `ended` or
 * `revoked` — both terminal.
 *
 * NO REVISION GUARD: `collaboration.client_engagement` carries no
 * `revision` column; `lockById` (`SELECT ... FOR UPDATE`), inspected before
 * any decision, is this command's entire concurrency guard — the identical
 * reasoning `EndGardenAssignment`'s own header applies at length for the
 * same absent-column, lock-then-decide shape.
 *
 * Source: implementation-plan.md work packages P9B-API-01, P9C-INVITE-01;
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

const OPERATION = 'client_engagements.activate';
const TARGET_STATE = 'active';

function engagementNotFound(): NotFoundError {
  return new NotFoundError(ClientEngagementErrorCode.NotFound, 'No engagement exists at this id.');
}

export class ActivateClientEngagement {
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
        // Idempotent no-op: already active.
        return toClientEngagementResource(locked);
      }
      if (!isValidClientEngagementTransition(locked.state, TARGET_STATE)) {
        throw new DomainRuleViolatedError(
          ClientEngagementErrorCode.InvalidTransition,
          `Cannot activate an engagement in state "${locked.state}".`,
        );
      }

      const now = this.clock.now();
      await context.clientEngagements.activate(locked.id, now);

      await context.auditLogger.record({
        eventType: 'client_engagement.activated',
        subjectType: 'client_engagement',
        subjectId: locked.id,
        actorProfileId,
        actorType: 'user',
        gardenId: locked.gardenId,
        details: { serviceOrganizationId: locked.serviceOrganizationId },
      });
      await context.outbox.append({
        eventType: 'client_engagement.activated',
        aggregateType: 'client_engagement',
        aggregateId: locked.id,
        payload: { gardenId: locked.gardenId, serviceOrganizationId: locked.serviceOrganizationId },
      });

      return toClientEngagementResource({
        ...locked,
        state: TARGET_STATE,
        activatedAt: now,
        updatedAt: now,
      });
    });
  }
}
