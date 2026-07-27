/**
 * Revokes a client access grant (P9C-INVITE-01) — the SAME authorized-
 * professional capability that creates one (`requireEngagementCapability`,
 * unchanged — see `create-client-invitation.ts`'s own header for why this is
 * the architecture's own silence read consistently, not a shortcut).
 *
 * WORKS ON A PENDING OR AN ACTIVE GRANT, DELIBERATELY — architecture/
 * collaboration-and-client-sharing.md section 9: "Revoke — the same
 * authorized-professional capability revokes a pending OR active grant;
 * must work whether the client ever accepted or not." See `domain/
 * client-access-grant-state.ts`'s own header for why this table's state
 * machine carries an `active -> revoked` edge `collaboration.invitation`'s
 * own machine does not: this row IS both the invitation and the client's
 * ongoing access grant.
 *
 * LOCK-THEN-DECIDE, mirroring `RevokePublisherAccess` exactly: the most
 * recent row is locked (`SELECT ... FOR UPDATE`) before any decision, not
 * read from a stale snapshot. IDEMPOTENT when already `revoked` (returned
 * unchanged, `200`). Refused with `422` from `expired` — a different
 * terminal state nothing un-expires.
 *
 * Source: implementation-plan.md work package P9C-INVITE-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "9. Client Invitation and Session".
 */

import type { ClientAccessGrant as ClientAccessGrantResource } from '@verdery/api-contracts';
import { ClientAccessGrantErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  NotFoundError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import { isValidClientAccessGrantTransition } from '../domain/client-access-grant-state.js';
import { revokeClientAccessGrant } from '../domain/client-access-grant.js';
import { toClientAccessGrantResource } from './client-access-grant-view.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { requireEngagementCapability } from './require-engagement-capability.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_engagements.client_invitations.revoke';

function grantNotFoundError(): NotFoundError {
  return new NotFoundError(
    ClientAccessGrantErrorCode.NotFound,
    'No client invitation exists at this id on this engagement.',
  );
}

export class RevokeClientInvitation {
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
    grantId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<ClientAccessGrantResource> {
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
      requestFingerprint: JSON.stringify({ engagementId, grantId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const found = await context.clientAccessGrants.findByIdAndEngagement(grantId, engagementId);
      if (found === null) {
        throw grantNotFoundError();
      }

      const locked = await context.clientAccessGrants.lockById(found.id);
      if (locked === null) {
        throw grantNotFoundError();
      }

      if (locked.state === 'revoked') {
        // Idempotent no-op: already revoked.
        return toClientAccessGrantResource(locked);
      }
      if (!isValidClientAccessGrantTransition(locked.state, 'revoked')) {
        throw new DomainRuleViolatedError(
          ClientAccessGrantErrorCode.InvalidTransition,
          `Cannot revoke a client invitation in state "${locked.state}".`,
        );
      }

      const now = this.clock.now();
      const revoked = revokeClientAccessGrant(locked, now);
      await context.clientAccessGrants.update(revoked);

      await context.auditLogger.record({
        eventType: 'client_access_grant.revoked',
        subjectType: 'client_access_grant',
        subjectId: locked.id,
        actorProfileId,
        actorType: 'user',
        gardenId: engagement.gardenId,
        details: { engagementId },
      });
      await context.outbox.append({
        eventType: 'client_access_grant.revoked',
        aggregateType: 'client_access_grant',
        aggregateId: locked.id,
        payload: { engagementId, gardenId: engagement.gardenId },
      });

      return toClientAccessGrantResource(revoked);
    });
  }
}
