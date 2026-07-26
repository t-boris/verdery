import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import {
  assertAcceptableState,
  assertEmailBindingSatisfied,
  createInvitation,
  isInvitationExpired,
  normalizeIntendedEmail,
  revokeInvitation,
} from './invitation.js';
import type { Invitation } from './invitation.js';

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

function buildInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'invitation-1',
    gardenId: 'garden-1',
    inviterProfileId: 'inviter-1',
    intendedRole: 'editor',
    intendedEmail: null,
    tokenHash: 'hash',
    state: 'pending',
    createdAt: JANUARY,
    expiresAt: MARCH,
    acceptedAt: null,
    revokedAt: null,
    acceptedByProfileId: null,
    resultingMembershipId: null,
    ...overrides,
  };
}

describe('normalizeIntendedEmail', () => {
  it('returns null for undefined, null, or blank input', () => {
    expect(normalizeIntendedEmail(undefined)).toBeNull();
    expect(normalizeIntendedEmail(null)).toBeNull();
    expect(normalizeIntendedEmail('   ')).toBeNull();
  });

  it('trims and lowercases a valid email', () => {
    expect(normalizeIntendedEmail('  Partner@Example.TEST  ')).toBe('partner@example.test');
  });

  it('rejects a string that is not a plausible email', () => {
    expect(() => normalizeIntendedEmail('not-an-email')).toThrow(ValidationError);
  });
});

describe('createInvitation', () => {
  it('builds a pending invitation with no acceptance or revocation state', () => {
    const invitation = createInvitation({
      id: 'inv-1',
      gardenId: 'garden-1',
      inviterProfileId: 'owner-1',
      intendedRole: 'viewer',
      intendedEmail: 'partner@example.test',
      tokenHash: 'hash',
      now: JANUARY,
      expiresAt: MARCH,
    });

    expect(invitation).toMatchObject({
      state: 'pending',
      acceptedAt: null,
      revokedAt: null,
      acceptedByProfileId: null,
      resultingMembershipId: null,
    });
  });
});

describe('isInvitationExpired', () => {
  it('is false before expiresAt and true at or after it', () => {
    const invitation = buildInvitation({ expiresAt: MARCH });
    expect(isInvitationExpired(invitation, JANUARY)).toBe(false);
    expect(isInvitationExpired(invitation, MARCH)).toBe(true);
    expect(isInvitationExpired(invitation, new Date(MARCH.getTime() + 1))).toBe(true);
  });
});

describe('revokeInvitation', () => {
  it('stamps state and revokedAt without touching anything else', () => {
    const invitation = buildInvitation();
    const revoked = revokeInvitation(invitation, MARCH);

    expect(revoked).toMatchObject({ state: 'revoked', revokedAt: MARCH });
    expect(revoked.id).toBe(invitation.id);
  });
});

describe('assertAcceptableState', () => {
  it('accepts a pending, unexpired invitation without throwing', () => {
    const invitation = buildInvitation({ state: 'pending', expiresAt: MARCH });
    expect(() => assertAcceptableState(invitation, JANUARY)).not.toThrow();
  });

  it('rejects a revoked invitation', () => {
    const invitation = buildInvitation({ state: 'revoked' });
    expect(() => assertAcceptableState(invitation, JANUARY)).toThrow(ConflictError);
    try {
      assertAcceptableState(invitation, JANUARY);
    } catch (error) {
      expect((error as ConflictError).code).toBe('collaboration.invitation.revoked');
    }
  });

  it('rejects an already-accepted invitation', () => {
    const invitation = buildInvitation({ state: 'accepted', acceptedAt: JANUARY });
    expect(() => assertAcceptableState(invitation, MARCH)).toThrow(ConflictError);
  });

  it('rejects an invitation already marked expired', () => {
    const invitation = buildInvitation({ state: 'expired' });
    expect(() => assertAcceptableState(invitation, JANUARY)).toThrowError(
      expect.objectContaining({ code: 'collaboration.invitation.expired' }),
    );
  });

  it('rejects a still-pending invitation whose expiresAt has passed (lazy expiry)', () => {
    const invitation = buildInvitation({ state: 'pending', expiresAt: JANUARY });
    expect(() => assertAcceptableState(invitation, new Date(JANUARY.getTime() + 1))).toThrowError(
      expect.objectContaining({ code: 'collaboration.invitation.expired' }),
    );
  });
});

describe('assertEmailBindingSatisfied', () => {
  it('passes for an unbound invitation regardless of caller email', () => {
    const invitation = buildInvitation({ intendedEmail: null });
    expect(() => assertEmailBindingSatisfied(invitation, undefined, false)).not.toThrow();
  });

  it('passes when the caller email matches, normalized, and is verified', () => {
    const invitation = buildInvitation({ intendedEmail: 'partner@example.test' });
    expect(() =>
      assertEmailBindingSatisfied(invitation, ' Partner@Example.TEST ', true),
    ).not.toThrow();
  });

  it('rejects a mismatched verified email', () => {
    const invitation = buildInvitation({ intendedEmail: 'partner@example.test' });
    expect(() =>
      assertEmailBindingSatisfied(invitation, 'someone-else@example.test', true),
    ).toThrow(ForbiddenError);
  });

  it('rejects a matching but UNVERIFIED email', () => {
    const invitation = buildInvitation({ intendedEmail: 'partner@example.test' });
    expect(() => assertEmailBindingSatisfied(invitation, 'partner@example.test', false)).toThrow(
      ForbiddenError,
    );
  });

  it('rejects an absent caller email', () => {
    const invitation = buildInvitation({ intendedEmail: 'partner@example.test' });
    expect(() => assertEmailBindingSatisfied(invitation, undefined, true)).toThrow(ForbiddenError);
  });
});
