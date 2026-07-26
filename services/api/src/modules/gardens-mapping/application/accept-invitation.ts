/**
 * Accepts a garden invitation as the AUTHENTICATED caller (P9A-API-01).
 *
 * IDENTIFIED BY TOKEN PLUS SESSION, NOT A BARE TOKEN. A bare-token accept
 * (no sign-in required, the token alone stands for the acceptor) would make
 * two things in section 10's own idempotency list impossible: "Existing
 * membership" needs to know WHOSE membership to check, and "Authenticated
 * email mismatch" needs a VERIFIED email claim to compare against — neither
 * exists without a session. It also matches the accepted-membership record:
 * `accepted_by_profile_id` names a real account, never an anonymous
 * possessor of a string. The cost is that a signed-out recipient must sign
 * in first, which every native and web client already requires for
 * everything else in this product.
 *
 * Every case from section 10's acceptance idempotency list, and where it is
 * decided:
 *
 *   - Existing membership              -> here, first (`resolveExistingMembership`)
 *   - Expired or revoked invitation    -> `domain/invitation.ts#assertAcceptableState`
 *   - Authenticated email mismatch     -> `domain/invitation.ts#assertEmailBindingSatisfied`
 *   - Ownership restrictions           -> structurally impossible: `InvitationRole`
 *                                          excludes `owner` at the type level, backed
 *                                          by `invitation_intended_role_check`. No
 *                                          branch here could violate it.
 *   - Invitation type/access-plane mismatch,
 *     Client engagement revoked/expired/not yet active
 *                                       -> not applicable. This schema has exactly one
 *                                          invitation type (operational); client
 *                                          invitations and engagements do not exist
 *                                          until P9C. Nothing to branch on yet.
 *   - Account deletion or suspension   -> enforced upstream, once, for every
 *                                          authenticated route: `registerAuthentication`
 *                                          rejects a non-`active` account before any
 *                                          handler runs (`isAccountUsable`). This route
 *                                          is not in the deletion-permitting group, so a
 *                                          caller who reaches this handler is already
 *                                          `active`.
 *
 * LAZY EXPIRY: a `pending` row past its own `expiresAt` is treated as
 * expired regardless of whether the sweep (`run-invitation-expiry-sweep.ts`)
 * has already run — checked and, if so, self-healed to `state = 'expired'`
 * in its OWN transaction, committed BEFORE the accept attempt itself runs
 * (`selfHealExpiry`, called first in `execute`). It cannot live inside the
 * same transaction as the rejection that follows it: that transaction rolls
 * back completely on the throw the corrected state is about to cause, which
 * would silently undo the correction. So a request racing the sweep can
 * never observe a stale `pending` row as acceptable, and the correction
 * survives even though the accept attempt itself is rejected.
 *
 * Source: implementation-plan.md work package P9A-API-01;
 * architecture/identity-and-authorization.md, section "10. Invitations".
 */

import type { GardenMember } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import {
  assertAcceptableState,
  assertEmailBindingSatisfied,
  isInvitationExpired,
} from '../domain/invitation.js';
import type { Invitation } from '../domain/invitation.js';
import type {
  GardensMappingUnitOfWork,
  GardensMappingTransactionContext,
} from './gardens-mapping-unit-of-work.js';
import { hashInvitationToken } from './invitation-token.js';
import { toGardenMemberResource } from './membership-view.js';
import { runIdempotentCommand } from './run-idempotent-command.js';

const OPERATION = 'invitations.accept';

export interface AcceptInvitationActor {
  readonly profileId: Uuid;
  readonly email: string | undefined;
  readonly emailVerified: boolean;
}

export class AcceptInvitation {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: GardensMappingUnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: AcceptInvitationActor,
    token: string,
    idempotencyKey: string,
  ): Promise<GardenMember> {
    // Never fingerprints the raw token — only its hash, which is exactly
    // what identifies the invitation. Keeping the secret itself out of
    // `platform.idempotency_record.request_fingerprint` matches "invitation
    // URLs and tokens are excluded from logs and analytics" in spirit, even
    // though this column is neither.
    const tokenHash = hashInvitationToken(token);

    // Self-heal a lapsed-but-not-yet-swept invitation FIRST, in its OWN
    // transaction that commits regardless of what happens next. This must
    // not live inside the idempotent command's own transaction below: that
    // transaction rolls back completely when it rejects (which the
    // self-healed row's very state is about to make it do), which would
    // undo the very correction this exists to make. Safe to run
    // unconditionally on every call, including replays: normalizing an
    // already-`expired` row to `expired` again is a no-op.
    await this.selfHealExpiry(tokenHash);

    const input = {
      actorProfileId: actor.profileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ tokenHash }),
    };

    return runIdempotentCommand(this.idempotency, this.unitOfWork, input, 200, async (context) => {
      const invitation = await context.invitations.findByTokenHash(tokenHash);
      if (invitation === null) {
        throw new NotFoundError(
          CollaborationErrorCode.InvitationNotFound,
          'No invitation exists at this token.',
        );
      }

      const existing = await resolveExistingMembership(
        context,
        invitation,
        actor.profileId,
        this.clock.now(),
      );
      if (existing !== null) {
        return toGardenMemberResource(existing);
      }

      const now = this.clock.now();

      assertAcceptableState(invitation, now);
      assertEmailBindingSatisfied(invitation, actor.email, actor.emailVerified);

      const membershipId = generateUuidV7();
      await context.memberships.insert(
        membershipId,
        invitation.gardenId,
        actor.profileId,
        invitation.intendedRole,
        now,
      );
      await context.memberships.openPeriod({
        id: generateUuidV7(),
        membershipId,
        gardenId: invitation.gardenId,
        profileId: actor.profileId,
        role: invitation.intendedRole,
        validFrom: now,
      });

      const accepted: Invitation = {
        ...invitation,
        state: 'accepted',
        acceptedAt: now,
        acceptedByProfileId: actor.profileId,
        resultingMembershipId: membershipId,
      };
      await context.invitations.update(accepted);

      // Two audit rows, matching the migration's own enumeration of what
      // must be audited: "every membership grant ... [and] invitation
      // issue/revoke/accept" names them as distinct event categories, not
      // one combined fact.
      await context.auditLogger.record({
        eventType: 'invitation.accepted',
        subjectType: 'invitation',
        subjectId: invitation.id,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId: invitation.gardenId,
      });
      await context.auditLogger.record({
        eventType: 'membership.granted',
        subjectType: 'membership',
        subjectId: membershipId,
        actorProfileId: actor.profileId,
        actorType: 'user',
        gardenId: invitation.gardenId,
        details: { role: invitation.intendedRole, viaInvitation: invitation.id },
      });
      await context.outbox.append({
        eventType: 'membership.granted',
        aggregateType: 'membership',
        aggregateId: membershipId,
        payload: {
          gardenId: invitation.gardenId,
          profileId: actor.profileId,
          role: invitation.intendedRole,
        },
      });

      // Sync emission for the new member's own client is deliberately NOT
      // done here — P9A-SYNC-01 owns wiring membership grants into the sync
      // change log (see this work package's own constraints: "sync ...
      // explicitly other work packages — do not build them").

      // Built from what this transaction just wrote, not re-read: every
      // field is already known, and a re-read could only ever confirm what
      // is already true inside the same transaction.
      return toGardenMemberResource({
        id: membershipId,
        gardenId: invitation.gardenId,
        profileId: actor.profileId,
        role: invitation.intendedRole,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  /** See the call site's comment in `execute` for why this commits independently of the accept attempt that follows it. */
  private async selfHealExpiry(tokenHash: string): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      const invitation = await context.invitations.findByTokenHash(tokenHash);
      if (invitation === null) {
        return;
      }
      if (invitation.state === 'pending' && isInvitationExpired(invitation, this.clock.now())) {
        await context.invitations.update({ ...invitation, state: 'expired' });
      }
    });
  }
}

/**
 * The "Existing membership" idempotency case. If the caller already has
 * ACTIVE membership on this invitation's garden — through this exact
 * invitation replayed outside the idempotency-key window, or through any
 * other path entirely — acceptance succeeds without creating a second
 * membership (`membership_garden_profile_key` would reject that anyway) and
 * without inspecting the invitation's own state at all.
 *
 * A still-`pending` invitation is additionally consumed here (marked
 * accepted, linked to the existing membership) so it does not linger toward
 * its own natural expiry for no reason; an already-terminal one is left
 * exactly as it is.
 */
async function resolveExistingMembership(
  context: GardensMappingTransactionContext,
  invitation: Invitation,
  profileId: Uuid,
  now: Date,
) {
  const existing = await context.memberships.findActiveByGardenAndProfile(
    invitation.gardenId,
    profileId,
  );
  if (existing === null) {
    return null;
  }

  if (invitation.state === 'pending') {
    await context.invitations.update({
      ...invitation,
      state: 'accepted',
      acceptedAt: now,
      acceptedByProfileId: profileId,
      resultingMembershipId: existing.id,
    });
  }

  return existing;
}
