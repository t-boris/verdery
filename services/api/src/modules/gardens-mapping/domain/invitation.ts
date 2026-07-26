/**
 * The operational invitation aggregate (P9A-API-01).
 *
 * Completes the skeleton `collaboration.invitation` left partial
 * (`invitation_intended_role_check` already excludes `owner` at the schema
 * level; P9A-DATA-01 added the acceptance/revocation instants and the
 * resulting-membership link). Ownership never travels through this
 * aggregate — see identity-and-authorization.md, section "10. Invitations":
 * "the initial ordinary invitation flow grants only editor or viewer".
 *
 * The token itself never lives on this entity: only its hash does, matching
 * "opaque, single-purpose, expiring tokens stored only as hashes" (same
 * section). `application/invitation-token.ts` owns generating and hashing
 * the raw secret; this file never sees it.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "10. Invitations"; architecture/collaboration-and-client-sharing.md,
 * section "5. Operational Invitation and Co-Ownership".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { GardenRole } from './garden-role.js';

/** The role vocabulary an invitation may name — never `owner`, mirroring `invitation_intended_role_check`. */
export type InvitationRole = Exclude<GardenRole, 'owner'>;

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invitation {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly inviterProfileId: Uuid;
  readonly intendedRole: InvitationRole;
  /** `null` for an unbound invitation — shareable with anyone who receives the link. Always lowercase when present (`invitation_intended_email_normalized_check`). */
  readonly intendedEmail: string | null;
  readonly tokenHash: string;
  readonly state: InvitationState;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly acceptedByProfileId: Uuid | null;
  readonly resultingMembershipId: Uuid | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims, lowercases, and validates a proposed intended email, or returns `null` for an unbound invitation. */
export function normalizeIntendedEmail(rawEmail: string | null | undefined): string | null {
  if (rawEmail === null || rawEmail === undefined || rawEmail.trim().length === 0) {
    return null;
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'intendedEmail is not a valid email address.',
      {
        details: [{ code: 'invitation.intended_email.invalid', pointer: '/intendedEmail' }],
      },
    );
  }

  return email;
}

export function createInvitation(input: {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly inviterProfileId: Uuid;
  readonly intendedRole: InvitationRole;
  readonly intendedEmail: string | null;
  readonly tokenHash: string;
  readonly now: Date;
  readonly expiresAt: Date;
}): Invitation {
  return {
    id: input.id,
    gardenId: input.gardenId,
    inviterProfileId: input.inviterProfileId,
    intendedRole: input.intendedRole,
    intendedEmail: input.intendedEmail,
    tokenHash: input.tokenHash,
    state: 'pending',
    createdAt: input.now,
    expiresAt: input.expiresAt,
    acceptedAt: null,
    revokedAt: null,
    acceptedByProfileId: null,
    resultingMembershipId: null,
  };
}

export function isInvitationExpired(invitation: Invitation, now: Date): boolean {
  return invitation.expiresAt.getTime() <= now.getTime();
}

export function revokeInvitation(invitation: Invitation, now: Date): Invitation {
  return {
    ...invitation,
    state: 'revoked',
    revokedAt: now,
  };
}

/**
 * Rejects an invitation that cannot be accepted for a reason the STATE
 * itself already carries — not-pending or lapsed. Email binding, "existing
 * membership", and every other case in section 10's idempotency list is a
 * relationship between the invitation and the ACCEPTING CALLER, so it is
 * decided in `application/accept-invitation.ts`, which has the caller in
 * scope; this function only ever sees the invitation row.
 *
 * Deliberately three distinct codes rather than one shared
 * "not acceptable": each is independently testable and lets a client
 * localize "someone already used this" differently from "this expired".
 */
export function assertAcceptableState(invitation: Invitation, now: Date): void {
  if (invitation.state === 'revoked') {
    throw new ConflictError(
      CollaborationErrorCode.InvitationRevoked,
      'This invitation was revoked.',
    );
  }

  if (invitation.state === 'accepted') {
    throw new ConflictError(
      CollaborationErrorCode.InvitationAlreadyAccepted,
      'This invitation was already accepted.',
    );
  }

  // 'expired', or 'pending' but past its own `expiresAt` — the lazy-expiry
  // case section 10's "an expired-but-not-yet-swept invitation must still be
  // treated as expired at acceptance time" describes. The caller
  // (`AcceptInvitation`) is responsible for persisting the self-heal to
  // `state = 'expired'` before this throws; this function only classifies.
  if (invitation.state === 'expired' || isInvitationExpired(invitation, now)) {
    throw new ConflictError(
      CollaborationErrorCode.InvitationExpired,
      'This invitation has expired.',
    );
  }
}

/**
 * Section 10's email-binding rule: an invitation naming an intended email
 * may be accepted only by a caller whose Firebase-VERIFIED email matches it,
 * normalized. An unverified or absent caller email can never satisfy a
 * binding — it is not proof of identity (identity-and-authorization.md,
 * section "7. Account States" treats an unverified claim as untrusted
 * presentation input elsewhere for the same reason).
 *
 * `403`, not `404`: the caller already knows this invitation exists (they
 * hold its secret token), so concealing existence buys nothing here — this
 * is a policy denial, the same posture `GardenAuthorization` uses once a
 * caller is already a known member.
 */
export function assertEmailBindingSatisfied(
  invitation: Invitation,
  callerEmail: string | undefined,
  callerEmailVerified: boolean,
): void {
  if (invitation.intendedEmail === null) {
    return;
  }

  const usableCallerEmail =
    callerEmailVerified && callerEmail !== undefined ? callerEmail.trim().toLowerCase() : undefined;

  if (usableCallerEmail !== invitation.intendedEmail) {
    throw new ForbiddenError(
      CollaborationErrorCode.InvitationEmailMismatch,
      'This invitation is addressed to a different email address.',
    );
  }
}
