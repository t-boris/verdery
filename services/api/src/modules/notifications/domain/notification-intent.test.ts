import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import type { NotificationIntent } from './notification-intent.js';
import { isInboxVisible, validateIntentStateTransition } from './notification-intent.js';

const NOW = new Date('2026-07-20T12:00:00Z');

function buildIntent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    id: '01890000-0000-7000-8000-000000000001',
    intentType: 'care_recommendation',
    intentVersion: 1,
    recipientProfileId: '01890000-0000-7000-8000-000000000002',
    gardenId: '01890000-0000-7000-8000-000000000003',
    recommendationCandidateId: '01890000-0000-7000-8000-000000000004',
    sourceEventId: '01890000-0000-7000-8000-000000000005',
    traceId: null,
    templateKey: 'care_recommendation.created.v1',
    templateParameters: {},
    priority: 'normal',
    channelInApp: true,
    channelPush: true,
    deepLink: {
      kind: 'gardenToday',
      gardenId: '01890000-0000-7000-8000-000000000003',
      recommendationCandidateId: '01890000-0000-7000-8000-000000000004',
    },
    dedupKey: 'care_recommendation:candidate:01890000-0000-7000-8000-000000000004',
    earliestDeliveryAt: NOW,
    expiresAt: new Date('2026-07-27T12:00:00Z'),
    state: 'pending',
    closeReason: null,
    nextDeliveryAttemptAt: null,
    deliveryAttemptCount: 0,
    readAt: null,
    dismissedAt: null,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('validateIntentStateTransition', () => {
  it('allows pending to close as superseded or expired', () => {
    expect(() => validateIntentStateTransition('pending', 'superseded')).not.toThrow();
    expect(() => validateIntentStateTransition('pending', 'expired')).not.toThrow();
  });

  it('allows pending to reach every delivery outcome (P7-NOTIF-02)', () => {
    expect(() => validateIntentStateTransition('pending', 'sent')).not.toThrow();
    expect(() => validateIntentStateTransition('pending', 'failed')).not.toThrow();
    expect(() => validateIntentStateTransition('pending', 'skipped')).not.toThrow();
  });

  it('refuses every edge out of a terminal state', () => {
    expect(() => validateIntentStateTransition('superseded', 'pending')).toThrow(
      DomainRuleViolatedError,
    );
    expect(() => validateIntentStateTransition('expired', 'superseded')).toThrow(
      DomainRuleViolatedError,
    );
    expect(() => validateIntentStateTransition('superseded', 'expired')).toThrow(
      DomainRuleViolatedError,
    );
    // The delivery outcomes are terminal too: a sent intent is never
    // re-sent, a failed one never resurrects (the next candidate mints a
    // NEW intent).
    expect(() => validateIntentStateTransition('sent', 'pending')).toThrow(DomainRuleViolatedError);
    expect(() => validateIntentStateTransition('sent', 'superseded')).toThrow(
      DomainRuleViolatedError,
    );
    expect(() => validateIntentStateTransition('failed', 'sent')).toThrow(DomainRuleViolatedError);
    expect(() => validateIntentStateTransition('skipped', 'expired')).toThrow(
      DomainRuleViolatedError,
    );
  });
});

describe('isInboxVisible', () => {
  it('lists a live pending in-app intent, read or not', () => {
    expect(isInboxVisible(buildIntent(), NOW)).toBe(true);
    // Read state does not remove an entry (section 12: read state is a
    // supported view fact, not a removal).
    expect(isInboxVisible(buildIntent({ readAt: NOW }), NOW)).toBe(true);
  });

  it('keeps delivery outcomes listed — push success or failure never determines inbox state (section 12)', () => {
    expect(isInboxVisible(buildIntent({ state: 'sent' }), NOW)).toBe(true);
    expect(
      isInboxVisible(buildIntent({ state: 'failed', closeReason: 'all_tokens_invalid' }), NOW),
    ).toBe(true);
    expect(
      isInboxVisible(buildIntent({ state: 'skipped', closeReason: 'push_channel_disabled' }), NOW),
    ).toBe(true);
  });

  it('hides dismissed, closed, push-only, and expired entries', () => {
    expect(isInboxVisible(buildIntent({ dismissedAt: NOW }), NOW)).toBe(false);
    expect(isInboxVisible(buildIntent({ state: 'superseded' }), NOW)).toBe(false);
    expect(isInboxVisible(buildIntent({ state: 'expired' }), NOW)).toBe(false);
    expect(isInboxVisible(buildIntent({ channelInApp: false }), NOW)).toBe(false);
    expect(isInboxVisible(buildIntent({ expiresAt: NOW }), NOW)).toBe(false);
    // A sent entry past its expiration lapses out of the list too — the
    // view-time comparison, not a state transition.
    expect(isInboxVisible(buildIntent({ state: 'sent', expiresAt: NOW }), NOW)).toBe(false);
  });
});
