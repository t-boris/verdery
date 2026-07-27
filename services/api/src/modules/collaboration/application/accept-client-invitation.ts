/**
 * Accepts a client invitation as the AUTHENTICATED caller (P9C-INVITE-01) —
 * steps 3-5 of architecture/collaboration-and-client-sharing.md section 9's
 * six-step flow: "3. The client signs in through Firebase, with email magic
 * link as the lowest-friction default. 4. The API verifies invitation state,
 * verified email, account state, engagement state, and replay/idempotency
 * conditions. 5. Acceptance creates or activates a client access grant."
 *
 * IDENTIFIED BY TOKEN PLUS SESSION, NOT A BARE TOKEN — the identical
 * reasoning `AcceptInvitation`'s own header gives at length: a bare token
 * cannot answer "whose verified email must match" or "is this the same
 * caller replaying." "Email magic link as the lowest-friction default" does
 * NOT mean the only accepted method — this command reads `actor.email`/
 * `actor.emailVerified` off `ActorContext` exactly like `AcceptInvitation`
 * does, whatever Firebase sign-in method populated them (magic link,
 * Google, Apple, password) — the SAME single verified-email-claim source
 * this codebase already established, not a second one built for clients.
 *
 * EVERY CASE FROM SECTION 9's STEP 4, AND WHERE IT IS DECIDED:
 *
 *   - Invitation state (pending, not expired, not revoked)
 *                                    -> `domain/client-access-grant.ts#assertClientAccessGrantAcceptable`
 *   - Verified email match           -> `domain/client-access-grant.ts#assertClientEmailBindingSatisfied`
 *   - Account state (not deleted/suspended)
 *                                    -> enforced upstream, once, for every
 *                                       authenticated route: `registerAuthentication`
 *                                       rejects a non-`active` account before any
 *                                       handler runs (`isAccountUsable`) — the
 *                                       identical posture `AcceptInvitation`'s own
 *                                       header documents for the operational case.
 *   - Engagement state (active)      -> here, after the grant itself is confirmed
 *                                       acceptable (an engagement that never
 *                                       activated, or was ended/revoked, cannot
 *                                       authorize a NEW acceptance — section 8:
 *                                       "An ended or revoked engagement cannot
 *                                       authorize new portal or media access").
 *   - Replay/idempotency             -> the "already active FOR THIS CALLER"
 *                                       shortcut below, mirroring
 *                                       `resolveExistingMembership`'s identical
 *                                       role in `AcceptInvitation`.
 *
 * LAZY EXPIRY, identical mechanism and reasoning to `AcceptInvitation`'s own
 * `selfHealExpiry`: a `pending` row past its own `expiresAt` self-heals to
 * `expired` in its OWN transaction, committed BEFORE the accept attempt
 * itself runs. NO BULK EXPIRY SWEEP EXISTS for `client_access_grant` (unlike
 * `collaboration.invitation`'s own `run-invitation-expiry-sweep.ts`) — not
 * built in this package because acceptance correctness never depends on one
 * having run (this self-heal covers every row anyone actually attempts to
 * accept); a sweep only ever matters for LISTING an accurate state for rows
 * nobody ever touches, which is a reasonable, small future addition, not a
 * gap in this command's own guarantees.
 *
 * Source: implementation-plan.md work package P9C-INVITE-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "9. Client Invitation and Session".
 */

import type { ClientAccessGrant as ClientAccessGrantResource } from '@verdery/api-contracts';
import { ClientAccessGrantErrorCode } from '@verdery/api-contracts';
import { ConflictError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  assertClientAccessGrantAcceptable,
  assertClientEmailBindingSatisfied,
  isClientAccessGrantExpired,
} from '../domain/client-access-grant.js';
import type { ClientAccessGrant } from '../domain/client-access-grant.js';
import { toClientAccessGrantResource } from './client-access-grant-view.js';
import { hashClientInvitationToken } from './client-invitation-token.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'client_invitations.accept';

export interface AcceptClientInvitationActor {
  readonly profileId: Uuid;
  readonly email: string | undefined;
  readonly emailVerified: boolean;
}

function grantNotFoundError(): NotFoundError {
  return new NotFoundError(
    ClientAccessGrantErrorCode.NotFound,
    'No client invitation exists at this token.',
  );
}

export class AcceptClientInvitation {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: AcceptClientInvitationActor,
    token: string,
    idempotencyKey: string,
  ): Promise<ClientAccessGrantResource> {
    // Never fingerprints the raw token — only its hash. See
    // `AcceptInvitation`'s identical comment.
    const tokenHash = hashClientInvitationToken(token);

    // Self-heal a lapsed-but-not-yet-swept grant FIRST, in its OWN
    // transaction that commits regardless of what happens next — see this
    // file's own header, "LAZY EXPIRY".
    await this.selfHealExpiry(tokenHash);

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ tokenHash }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const grant = await context.clientAccessGrants.findByTokenHash(tokenHash);
      if (grant === null) {
        throw grantNotFoundError();
      }

      // Idempotent replay: the SAME caller who already accepted this exact
      // token. Never re-validates email binding or expiry — the token was
      // already consumed successfully once. A DIFFERENT caller reaching an
      // `active` grant below is a genuine conflict, not this shortcut.
      if (grant.state === 'active' && grant.clientProfileId === actor.profileId) {
        return toClientAccessGrantResource(grant);
      }

      const now = this.clock.now();

      assertClientAccessGrantAcceptable(grant, now);
      assertClientEmailBindingSatisfied(grant, actor.email, actor.emailVerified);

      const engagement = await context.clientEngagements.findById(grant.engagementId);
      if (engagement === null || engagement.state !== 'active') {
        throw new ConflictError(
          ClientAccessGrantErrorCode.EngagementNotActive,
          'This invitation’s engagement is not currently active.',
        );
      }

      const activated: ClientAccessGrant = {
        ...grant,
        state: 'active',
        clientProfileId: actor.profileId,
        grantedAt: now,
      };
      await context.clientAccessGrants.update(activated);

      await context.auditLogger.record({
        eventType: 'client_access_grant.accepted',
        subjectType: 'client_access_grant',
        subjectId: grant.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId: engagement.gardenId,
        details: { engagementId: grant.engagementId },
      });
      await context.outbox.append({
        eventType: 'client_access_grant.accepted',
        aggregateType: 'client_access_grant',
        aggregateId: grant.id,
        payload: { engagementId: grant.engagementId, clientProfileId: actor.profileId },
      });

      return toClientAccessGrantResource(activated);
    });
  }

  /** See the call site's comment in `execute` for why this commits independently of the accept attempt that follows it. */
  private async selfHealExpiry(tokenHash: string): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      const grant = await context.clientAccessGrants.findByTokenHash(tokenHash);
      if (grant === null) {
        return;
      }
      if (grant.state === 'pending' && isClientAccessGrantExpired(grant, this.clock.now())) {
        await context.clientAccessGrants.update({ ...grant, state: 'expired' });
      }
    });
  }
}
