import { describe, expect, it } from 'vitest';
import {
  beginPurgeAttempt,
  claimPurge,
  completePurge,
  deferPurge,
  recordIdentityProviderDeletion,
  recordScheduledMediaDeletions,
} from './deletion-record.js';
import type { DeletionRecord } from './deletion-record.js';

const RECORD_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0b';
const SUBJECT_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0c';
const ACTOR_ID = '019827ab-4c1d-7e3f-9a2b-5c6d7e8f9a0d';
const REQUESTED_AT = new Date('2026-07-25T09:00:00Z');
const DEADLINE = new Date('2026-08-24T09:00:00Z');
const NOW = new Date('2026-08-24T10:00:00Z');
const LATER = new Date('2026-08-24T11:00:00Z');

function claimed(): DeletionRecord {
  return claimPurge(
    {
      id: RECORD_ID,
      subjectType: 'garden',
      subjectId: SUBJECT_ID,
      requestedByProfileId: ACTOR_ID,
      requestedAt: REQUESTED_AT,
      recoveryDeadlineAt: DEADLINE,
    },
    NOW,
  );
}

describe('claimPurge', () => {
  it('starts purging with the window it honored copied off the subject, so the evidence outlives it', () => {
    expect(claimed()).toMatchObject({
      state: 'purging',
      requestedAt: REQUESTED_AT,
      recoveryDeadlineAt: DEADLINE,
      purgeStartedAt: NOW,
      attemptCount: 0,
      completedAt: null,
      deferredReason: null,
      mediaRecordsScheduled: 0,
      identityProviderDeletedAt: null,
    });
  });
});

describe('the purge job transitions', () => {
  it('counts each sweep pass and clears whatever the previous one was waiting on', () => {
    const deferred = deferPurge(claimed(), 'media_deletion_pending', NOW);
    const retried = beginPurgeAttempt(deferred, LATER);

    expect(retried).toMatchObject({ attemptCount: 1, deferredReason: null, state: 'purging' });
  });

  it('accumulates scheduled media as a count, never a list of what was deleted', () => {
    const once = recordScheduledMediaDeletions(claimed(), 3, NOW);
    const twice = recordScheduledMediaDeletions(once, 2, LATER);

    expect(twice.mediaRecordsScheduled).toBe(5);
    expect(Object.keys(twice)).not.toContain('mediaIds');
  });

  it('records the identity-provider deletion once and then leaves it alone', () => {
    const first = recordIdentityProviderDeletion(claimed(), NOW);
    expect(first.identityProviderDeletedAt).toBe(NOW);
    // A resumed purge calls this again; the original instant is the truth.
    expect(recordIdentityProviderDeletion(first, LATER)).toBe(first);
  });

  it('completes once, idempotently, clearing the deferral reason', () => {
    const done = completePurge(deferPurge(claimed(), 'media_deletion_pending', NOW), LATER);

    expect(done).toMatchObject({ state: 'purged', completedAt: LATER, deferredReason: null });
    expect(completePurge(done, LATER)).toBe(done);
  });

  it('refuses every further transition once purged — a finished purge is evidence, not a job', () => {
    const done = completePurge(claimed(), LATER);

    expect(() => beginPurgeAttempt(done, LATER)).toThrow();
    expect(() => deferPurge(done, 'anything', LATER)).toThrow();
    expect(() => recordScheduledMediaDeletions(done, 1, LATER)).toThrow();
    expect(() => recordIdentityProviderDeletion(done, LATER)).toThrow();
  });
});
