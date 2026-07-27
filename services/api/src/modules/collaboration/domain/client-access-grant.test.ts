import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import {
  assertClientAccessGrantAcceptable,
  assertClientEmailBindingSatisfied,
  createClientAccessGrantInvitation,
  isClientAccessGrantExpired,
  normalizeInvitedEmail,
  revokeClientAccessGrant,
} from './client-access-grant.js';
import type { ClientAccessGrant } from './client-access-grant.js';
import { isValidClientAccessGrantTransition } from './client-access-grant-state.js';

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

function buildGrant(overrides: Partial<ClientAccessGrant> = {}): ClientAccessGrant {
  return {
    id: 'grant-1',
    engagementId: 'engagement-1',
    clientProfileId: null,
    invitedEmail: 'client@example.test',
    tokenHash: 'hash',
    state: 'pending',
    grantedAt: null,
    revokedAt: null,
    expiresAt: MARCH,
    createdAt: JANUARY,
    ...overrides,
  };
}

describe('normalizeInvitedEmail', () => {
  it('rejects undefined, null, or blank input — client invitations are always email-bound', () => {
    expect(() => normalizeInvitedEmail(undefined)).toThrow(ValidationError);
    expect(() => normalizeInvitedEmail(null)).toThrow(ValidationError);
    expect(() => normalizeInvitedEmail('   ')).toThrow(ValidationError);
  });

  it('trims and lowercases a valid email', () => {
    expect(normalizeInvitedEmail('  Client@Example.TEST  ')).toBe('client@example.test');
  });

  it('rejects a string that is not a plausible email', () => {
    expect(() => normalizeInvitedEmail('not-an-email')).toThrow(ValidationError);
  });
});

describe('createClientAccessGrantInvitation', () => {
  it('builds a new pending grant with no bound profile or grant instant yet', () => {
    const grant = createClientAccessGrantInvitation({
      id: 'grant-1',
      engagementId: 'engagement-1',
      invitedEmail: 'client@example.test',
      tokenHash: 'hash',
      now: JANUARY,
      expiresAt: MARCH,
    });

    expect(grant).toEqual({
      id: 'grant-1',
      engagementId: 'engagement-1',
      clientProfileId: null,
      invitedEmail: 'client@example.test',
      tokenHash: 'hash',
      state: 'pending',
      grantedAt: null,
      revokedAt: null,
      expiresAt: MARCH,
      createdAt: JANUARY,
    });
  });
});

describe('isClientAccessGrantExpired', () => {
  it('is expired once now is at or past expiresAt', () => {
    expect(isClientAccessGrantExpired(buildGrant({ expiresAt: MARCH }), MARCH)).toBe(true);
    expect(
      isClientAccessGrantExpired(buildGrant({ expiresAt: MARCH }), new Date(MARCH.getTime() + 1)),
    ).toBe(true);
    expect(isClientAccessGrantExpired(buildGrant({ expiresAt: MARCH }), JANUARY)).toBe(false);
  });

  it('is never expired when expiresAt is null (the no-token direct-grant case)', () => {
    expect(isClientAccessGrantExpired(buildGrant({ expiresAt: null }), MARCH)).toBe(false);
  });
});

describe('revokeClientAccessGrant', () => {
  it('sets state revoked and revokedAt, leaving every other field untouched', () => {
    const grant = buildGrant({ state: 'active', clientProfileId: 'client-1', grantedAt: JANUARY });
    const revoked = revokeClientAccessGrant(grant, MARCH);

    expect(revoked).toEqual({ ...grant, state: 'revoked', revokedAt: MARCH });
  });
});

describe('assertClientAccessGrantAcceptable', () => {
  it('throws Revoked for a revoked grant', () => {
    expect(() =>
      assertClientAccessGrantAcceptable(
        buildGrant({ state: 'revoked', revokedAt: JANUARY }),
        JANUARY,
      ),
    ).toThrow(ConflictError);
  });

  it('throws AlreadyAccepted for an active grant — reached only when NOT already the same caller (the command’s own shortcut handles that case first)', () => {
    expect(() =>
      assertClientAccessGrantAcceptable(
        buildGrant({ state: 'active', clientProfileId: 'someone-else', grantedAt: JANUARY }),
        JANUARY,
      ),
    ).toThrow(ConflictError);
  });

  it('throws Expired for an explicitly expired grant, and for a pending grant past its own expiresAt (lazy expiry)', () => {
    expect(() =>
      assertClientAccessGrantAcceptable(buildGrant({ state: 'expired' }), JANUARY),
    ).toThrow(ConflictError);
    expect(() =>
      assertClientAccessGrantAcceptable(
        buildGrant({ state: 'pending', expiresAt: JANUARY }),
        new Date(JANUARY.getTime() + 1),
      ),
    ).toThrow(ConflictError);
  });

  it('does not throw for a still-valid pending grant', () => {
    expect(() =>
      assertClientAccessGrantAcceptable(
        buildGrant({ state: 'pending', expiresAt: MARCH }),
        JANUARY,
      ),
    ).not.toThrow();
  });
});

describe('assertClientEmailBindingSatisfied', () => {
  it('rejects an unverified caller email, even when the address string matches', () => {
    expect(() =>
      assertClientEmailBindingSatisfied(
        buildGrant({ invitedEmail: 'client@example.test' }),
        'client@example.test',
        false,
      ),
    ).toThrow(ForbiddenError);
  });

  it('rejects an absent caller email', () => {
    expect(() =>
      assertClientEmailBindingSatisfied(
        buildGrant({ invitedEmail: 'client@example.test' }),
        undefined,
        true,
      ),
    ).toThrow(ForbiddenError);
  });

  it('rejects a verified email that differs, normalized', () => {
    expect(() =>
      assertClientEmailBindingSatisfied(
        buildGrant({ invitedEmail: 'client@example.test' }),
        'someone-else@example.test',
        true,
      ),
    ).toThrow(ForbiddenError);
  });

  it('accepts a matching, verified caller email, normalized case-insensitively', () => {
    expect(() =>
      assertClientEmailBindingSatisfied(
        buildGrant({ invitedEmail: 'client@example.test' }),
        'Client@Example.TEST',
        true,
      ),
    ).not.toThrow();
  });

  it('treats a grant with no invited email at all as a data-integrity defect, never a silent pass', () => {
    expect(() =>
      assertClientEmailBindingSatisfied(
        buildGrant({ invitedEmail: null }),
        'client@example.test',
        true,
      ),
    ).toThrow(InternalError);
  });
});

describe('isValidClientAccessGrantTransition', () => {
  it('allows pending to reach active, revoked, or expired', () => {
    expect(isValidClientAccessGrantTransition('pending', 'active')).toBe(true);
    expect(isValidClientAccessGrantTransition('pending', 'revoked')).toBe(true);
    expect(isValidClientAccessGrantTransition('pending', 'expired')).toBe(true);
  });

  it('allows active to reach only revoked — the edge collaboration.invitation’s own machine does not have', () => {
    expect(isValidClientAccessGrantTransition('active', 'revoked')).toBe(true);
    expect(isValidClientAccessGrantTransition('active', 'expired')).toBe(false);
    expect(isValidClientAccessGrantTransition('active', 'pending')).toBe(false);
  });

  it('treats revoked and expired as terminal', () => {
    expect(isValidClientAccessGrantTransition('revoked', 'active')).toBe(false);
    expect(isValidClientAccessGrantTransition('revoked', 'pending')).toBe(false);
    expect(isValidClientAccessGrantTransition('expired', 'active')).toBe(false);
    expect(isValidClientAccessGrantTransition('expired', 'revoked')).toBe(false);
  });
});
