/**
 * Revokes a pending garden invitation (P9A-API-01).
 *
 * Owner-only (`manageGarden`, matrix row H5). Idempotent BY DESIGN, not
 * merely by the `Idempotency-Key` mechanism every command already has:
 * revoking an invitation that is already revoked, accepted, or expired
 * returns its current state unchanged rather than erroring — the task's own
 * completion evidence names this explicitly ("revoking an already-revoked/
 * accepted/expired invitation does not error into a 500"), and a second
 * owner racing the first to revoke the same invitation must see success,
 * not a spurious conflict.
 *
 * Source: implementation-plan.md work package P9A-API-01.
 */

import type { Invitation as InvitationResource } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import { revokeInvitation as buildRevoked } from '../domain/invitation.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { toInvitationResource } from './invitation-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'invitations.revoke';

export class RevokeInvitation {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    invitationId: Uuid,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<InvitationResource> {
    await this.authorization.requireCapability(gardenId, actorProfileId, 'manageGarden');

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ gardenId, invitationId }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const invitation = await context.invitations.findByIdAndGarden(invitationId, gardenId);
      if (invitation === null) {
        throw new NotFoundError(
          CollaborationErrorCode.InvitationNotFound,
          'No invitation exists at this id on this garden.',
        );
      }

      if (invitation.state !== 'pending') {
        // Already terminal — return it unchanged rather than re-deriving a
        // "revoked" state that might not even be true (an already-accepted
        // invitation must never be overwritten to look revoked).
        return toInvitationResource(invitation);
      }

      const now = this.clock.now();
      const revoked = buildRevoked(invitation, now);
      await context.invitations.update(revoked);

      await context.outbox.append({
        eventType: 'invitation.revoked',
        aggregateType: 'invitation',
        aggregateId: revoked.id,
        payload: { gardenId },
      });
      await context.auditLogger.record({
        eventType: 'invitation.revoked',
        subjectType: 'invitation',
        subjectId: revoked.id,
        actorProfileId,
        actorType: 'user',
        gardenId,
      });

      return toInvitationResource(revoked);
    });
  }
}
