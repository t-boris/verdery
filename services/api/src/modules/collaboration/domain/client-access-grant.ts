/**
 * The `client_access_grant` aggregate (P9C-INVITE-01) — completing the
 * skeleton `1786600000000_service-organizations-and-client-engagements.sql`
 * deliberately left partial, the same way `gardens-mapping/domain/
 * invitation.ts` completed `collaboration.invitation`'s own skeleton for
 * P9A-API-01. Mirrors that file's shape closely: email normalization, the
 * acceptability assertion, and the email-binding assertion are the identical
 * three responsibilities, adapted to this table's own four-state vocabulary
 * and its one extra transition (`active -> revoked`, see `domain/
 * client-access-grant-state.ts`'s own header for why).
 *
 * ONE DELIBERATE DIFFERENCE FROM `invitation.ts`: `invitedEmail` is never
 * optional here. Section "9. Client Invitation and Session" describes only
 * an email-bound flow ("An authorized professional creates an EMAIL-BOUND
 * invitation") and the package's own constraint is explicit — "No anonymous
 * public links" — so `normalizeInvitedEmail`, unlike `normalizeIntendedEmail`,
 * always returns a real address or throws; there is no unbound-invitation
 * branch to preserve.
 *
 * The raw token itself never lives on this entity, only its hash — see
 * `application/client-invitation-token.ts`'s own header for the identical
 * reasoning `gardens-mapping/application/invitation-token.ts` already gives.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "9. Client Invitation and Session"; implementation-plan.md work package
 * P9C-INVITE-01.
 */

import { ClientAccessGrantErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ClientAccessGrantState } from './client-access-grant-state.js';

export interface ClientAccessGrant {
  readonly id: Uuid;
  readonly engagementId: Uuid;
  /** `null` until a real invitation is accepted and binds a profile. */
  readonly clientProfileId: Uuid | null;
  /**
   * Always lowercase when present
   * (`client_access_grant_invited_email_normalized_check`). Stays set even
   * after acceptance — a historical fact, not cleared on activation, the
   * same posture `collaboration.invitation.intended_email` already takes.
   */
  readonly invitedEmail: string | null;
  /** `null` only for a grant this package's own commands never produce — a hypothetical direct grant with no invitation step. See the migration's own "BOTH COLUMNS STAY NULLABLE" comment. */
  readonly tokenHash: string | null;
  readonly state: ClientAccessGrantState;
  readonly grantedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims, lowercases, and validates a required invited email — never `null`, unlike the operational invitation's own optional `intendedEmail`. See this file's own header, "ONE DELIBERATE DIFFERENCE". */
export function normalizeInvitedEmail(rawEmail: string | null | undefined): string {
  if (rawEmail === null || rawEmail === undefined || rawEmail.trim().length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'email is required.', {
      details: [{ code: 'client_access_grant.email.required', pointer: '/email' }],
    });
  }

  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'email is not a valid email address.',
      {
        details: [{ code: 'client_access_grant.email.invalid', pointer: '/email' }],
      },
    );
  }

  return email;
}

export function createClientAccessGrantInvitation(input: {
  readonly id: Uuid;
  readonly engagementId: Uuid;
  readonly invitedEmail: string;
  readonly tokenHash: string;
  readonly now: Date;
  readonly expiresAt: Date;
}): ClientAccessGrant {
  return {
    id: input.id,
    engagementId: input.engagementId,
    clientProfileId: null,
    invitedEmail: input.invitedEmail,
    tokenHash: input.tokenHash,
    state: 'pending',
    grantedAt: null,
    revokedAt: null,
    expiresAt: input.expiresAt,
    createdAt: input.now,
  };
}

export function isClientAccessGrantExpired(grant: ClientAccessGrant, now: Date): boolean {
  return grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime();
}

export function revokeClientAccessGrant(grant: ClientAccessGrant, now: Date): ClientAccessGrant {
  return { ...grant, state: 'revoked', revokedAt: now };
}

/**
 * Rejects a grant that cannot be accepted for a reason the STATE itself
 * already carries. Mirrors `assertAcceptableState`'s three-distinct-codes
 * posture exactly, with one difference in ordering: this function is called
 * ONLY after `AcceptClientInvitation` has already handled the "already
 * active for THIS caller" idempotent-replay shortcut, so `state === 'active'`
 * reaching here always means the grant was already claimed by a DIFFERENT
 * profile — genuinely `alreadyAccepted`, never a false conflict for the
 * rightful owner replaying.
 */
export function assertClientAccessGrantAcceptable(grant: ClientAccessGrant, now: Date): void {
  if (grant.state === 'revoked') {
    throw new ConflictError(
      ClientAccessGrantErrorCode.Revoked,
      'This client invitation was revoked.',
    );
  }

  if (grant.state === 'active') {
    throw new ConflictError(
      ClientAccessGrantErrorCode.AlreadyAccepted,
      'This client invitation was already accepted.',
    );
  }

  // 'expired', or 'pending' but past its own `expiresAt` — the identical
  // lazy-expiry case `assertAcceptableState`'s own comment describes. The
  // caller (`AcceptClientInvitation`) persists the self-heal to
  // `state = 'expired'` before this throws.
  if (grant.state === 'expired' || isClientAccessGrantExpired(grant, now)) {
    throw new ConflictError(
      ClientAccessGrantErrorCode.Expired,
      'This client invitation has expired.',
    );
  }
}

/**
 * Section 9's email-binding rule, identical in spirit to
 * `assertEmailBindingSatisfied`: only a caller whose Firebase-VERIFIED email
 * matches the grant's bound email, normalized, may accept. An unverified or
 * absent caller email can never satisfy a binding.
 *
 * `grant.invitedEmail === null` is treated as a DATA-INTEGRITY defect, not a
 * pass-through: every grant reachable through this path was created by this
 * package's own `CreateClientInvitation`, which always sets an email
 * alongside a token (see the migration's own paired-column CHECK) — a token
 * with no bound email would mean the "no anonymous public links" constraint
 * was somehow violated at the data layer, and this function never trusts
 * that silently.
 */
export function assertClientEmailBindingSatisfied(
  grant: ClientAccessGrant,
  callerEmail: string | undefined,
  callerEmailVerified: boolean,
): void {
  if (grant.invitedEmail === null) {
    throw new InternalError(
      'collaboration.client_access_grant.missing_invited_email',
      'An invitation-created client access grant has no bound email.',
    );
  }

  const usableCallerEmail =
    callerEmailVerified && callerEmail !== undefined ? callerEmail.trim().toLowerCase() : undefined;

  if (usableCallerEmail !== grant.invitedEmail) {
    throw new ForbiddenError(
      ClientAccessGrantErrorCode.EmailMismatch,
      'This invitation is addressed to a different email address.',
    );
  }
}
