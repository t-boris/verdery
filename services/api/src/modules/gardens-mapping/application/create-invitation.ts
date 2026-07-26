/**
 * Issues an operational garden invitation (P9A-API-01).
 *
 * Owner-only (`manageGarden` — see this module's `garden-role.ts` and the
 * frozen capability matrix, row H3: "Create an ordinary invitation ...
 * Owner. Editor/viewer Denied"; no dedicated `manageMembership` capability
 * exists yet, so this reuses the same owner-administration capability the
 * matrix's gap G-3 explicitly leaves to a later package).
 *
 * The one-pending-per-(garden, email) rule is enforced twice, deliberately:
 * an application-level pre-check for the ordinary case's clean error, and
 * the database's own `invitation_pending_intended_email_key` for the
 * genuine concurrent race the pre-check cannot see — caught here and
 * translated so a raw unique-violation never reaches a client as a 500.
 *
 * Source: implementation-plan.md work package P9A-API-01;
 * architecture/identity-and-authorization.md, section "10. Invitations".
 */

import { CollaborationErrorCode } from '@verdery/api-contracts';
import type { CreateInvitationResult } from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import { ConflictError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  createInvitation as buildInvitation,
  normalizeIntendedEmail,
} from '../domain/invitation.js';
import type { InvitationRole } from '../domain/invitation.js';
import type { GardenAuthorization } from './garden-authorization.js';
import type { GardensMappingUnitOfWork } from './gardens-mapping-unit-of-work.js';
import { generateInvitationToken, hashInvitationToken } from './invitation-token.js';
import { toCreateInvitationResult } from './invitation-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'invitations.create';

/**
 * Default lifetime for an invitation with no client-specified expiry. Not
 * yet configurable — no document names a specific number, and a fixed
 * constant is the honest reading of that silence rather than inventing a
 * request field this pass has no other use for. A week matches the
 * lowest-friction expectation for a household/team invite link (long enough
 * to reach an inbox and be acted on, short enough that a stale unopened
 * invite does not linger indefinitely).
 */
export const INVITATION_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

const PENDING_EMAIL_CONSTRAINT = 'invitation_pending_intended_email_key';

export interface CreateInvitationInput {
  readonly intendedRole: InvitationRole;
  readonly intendedEmail?: string;
}

export class CreateInvitation {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly authorization: GardenAuthorization,
    private readonly clock: Clock,
  ) {}

  async execute(
    gardenId: Uuid,
    actorProfileId: Uuid,
    request: CreateInvitationInput,
    idempotencyKey: string,
  ): Promise<CreateInvitationResult> {
    await this.authorization.requireCapability(gardenId, actorProfileId, 'manageGarden');

    const intendedEmail = normalizeIntendedEmail(request.intendedEmail);

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({
        gardenId,
        intendedRole: request.intendedRole,
        intendedEmail,
      }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 201, async (context) => {
      if (intendedEmail !== null) {
        const alreadyPending = await context.invitations.hasPendingForEmail(
          gardenId,
          intendedEmail,
        );
        if (alreadyPending) {
          throw new ConflictError(
            CollaborationErrorCode.InvitationAlreadyPending,
            'A pending invitation already exists for this garden and email.',
          );
        }
      }

      const now = this.clock.now();
      const token = generateInvitationToken();
      const invitation = buildInvitation({
        id: generateUuidV7(),
        gardenId,
        inviterProfileId: actorProfileId,
        intendedRole: request.intendedRole,
        intendedEmail,
        tokenHash: hashInvitationToken(token),
        now,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MILLISECONDS),
      });

      try {
        await context.invitations.insert(invitation);
      } catch (error) {
        if (
          isUniqueViolation(error) &&
          postgresConstraintName(error) === PENDING_EMAIL_CONSTRAINT
        ) {
          throw new ConflictError(
            CollaborationErrorCode.InvitationAlreadyPending,
            'A pending invitation already exists for this garden and email.',
            { cause: error },
          );
        }
        throw error;
      }

      await context.outbox.append({
        eventType: 'invitation.issued',
        aggregateType: 'invitation',
        aggregateId: invitation.id,
        payload: { gardenId, intendedRole: invitation.intendedRole },
      });
      await context.auditLogger.record({
        eventType: 'invitation.issued',
        subjectType: 'invitation',
        subjectId: invitation.id,
        actorProfileId,
        actorType: 'user',
        gardenId,
        details: {
          intendedRole: invitation.intendedRole,
          hasIntendedEmail: intendedEmail !== null,
        },
      });

      return toCreateInvitationResult(invitation, token);
    });
  }
}
