import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import {
  claimAccountForPurge,
  markAccountPurged,
  provisionProfile,
  purgedFirebaseUid,
  requestAccountDeletion,
  restoreAccount,
} from './profile.js';
import type { Profile } from './profile.js';
import { isAccountUsable } from './account-state.js';

const PROFILE_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const NOW = new Date('2026-07-25T09:00:00Z');
const LATER = new Date('2026-07-25T10:00:00Z');
const DEADLINE = new Date('2026-08-24T09:00:00Z');

function activeProfile(): Profile {
  return provisionProfile(PROFILE_ID, 'firebase-uid-1', NOW);
}

function deleting(): Profile {
  return requestAccountDeletion(activeProfile(), DEADLINE, LATER);
}

describe('the account deletion state machine (P8-DELETE-01)', () => {
  it('moves active to deletion_requested, which by itself disables ordinary access', () => {
    const requested = deleting();

    expect(requested).toMatchObject({
      accountState: 'deletion_requested',
      deletionRequestedAt: LATER,
      recoveryDeadlineAt: DEADLINE,
      revision: 2,
    });
    // No separate "disable" step exists because none is needed: the state
    // itself is what every authorization check already reads.
    expect(isAccountUsable(requested.accountState)).toBe(false);
  });

  it('refuses a second request, and refuses to start from any state but active', () => {
    expect(() => requestAccountDeletion(deleting(), DEADLINE, LATER)).toThrow(
      expect.objectContaining({ code: 'deletion.already_requested' }) as Error,
    );
    expect(() =>
      requestAccountDeletion({ ...activeProfile(), accountState: 'suspended' }, DEADLINE, LATER),
    ).toThrow(DomainRuleViolatedError);
  });

  it('restores to active, clearing the window', () => {
    const restored = restoreAccount(deleting(), LATER);

    expect(restored).toMatchObject({
      accountState: 'active',
      deletionRequestedAt: null,
      recoveryDeadlineAt: null,
    });
    expect(isAccountUsable(restored.accountState)).toBe(true);
  });

  it('refuses to restore once the purge is claimed, and when nothing is pending', () => {
    const claimed = claimAccountForPurge(deleting(), LATER);

    expect(() => restoreAccount(claimed, LATER)).toThrow(
      expect.objectContaining({ code: 'deletion.not_recoverable' }) as Error,
    );
    expect(() => restoreAccount(activeProfile(), LATER)).toThrow(
      expect.objectContaining({ code: 'deletion.not_found' }) as Error,
    );
  });

  it('claims into disabled — the documented state between request and purge — and re-claiming burns no revision', () => {
    const claimed = claimAccountForPurge(deleting(), LATER);

    expect(claimed.accountState).toBe('disabled');
    expect(claimAccountForPurge(claimed, LATER)).toBe(claimed);
    expect(() => claimAccountForPurge(activeProfile(), LATER)).toThrow(DomainRuleViolatedError);
  });

  it('minimizes the row to a tombstone: an unresolvable uid, default settings, and nothing personal left', () => {
    const purged = markAccountPurged(claimAccountForPurge(deleting(), LATER), LATER);

    expect(purged).toMatchObject({
      id: PROFILE_ID,
      accountState: 'purged',
      // Derived from the profile id: it cannot collide with a real Firebase
      // uid and cannot be used to look the person up.
      firebaseUid: purgedFirebaseUid(PROFILE_ID),
      locale: 'en',
      timeZone: 'UTC',
      deletionRequestedAt: null,
      recoveryDeadlineAt: null,
      purgedAt: LATER,
    });
    expect(purged.firebaseUid).not.toContain('firebase-uid-1');
  });

  it('completes a purge only from a claimed one — never straight from the recovery window', () => {
    expect(() => markAccountPurged(deleting(), LATER)).toThrow(DomainRuleViolatedError);
    expect(() => markAccountPurged(activeProfile(), LATER)).toThrow(DomainRuleViolatedError);
  });
});
