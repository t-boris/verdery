/**
 * The send-time recheck matrix (P7-NOTIF-02) — notifications.md section
 * 9's list as direct unit assertions over `decideSendTimeAction`, plus
 * the push payload's privacy shape and the bounded transient-retry
 * policy. The STALE-INTENT classifications here are the work package's
 * named acceptance evidence at the domain layer.
 */

import { describe, expect, it } from 'vitest';
import type { NotificationIntent } from './notification-intent.js';
import type { SendTimeFacts } from './notification-delivery.js';
import {
  buildPushMessageData,
  decideSendTimeAction,
  DELIVERY_RETRY_BASE_DELAY_MS,
  MAX_DELIVERY_ATTEMPTS,
  resolveTransientRetryAt,
} from './notification-delivery.js';
import { UNWRITTEN_PREFERENCE_SETTINGS } from './notification-preference.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const GARDEN_ID = '01890000-0000-7000-8000-000000000003';
const CANDIDATE_ID = '01890000-0000-7000-8000-000000000004';

function buildIntent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    id: '01890000-0000-7000-8000-000000000001',
    intentType: 'care_recommendation',
    intentVersion: 1,
    recipientProfileId: '01890000-0000-7000-8000-000000000002',
    gardenId: GARDEN_ID,
    recommendationCandidateId: CANDIDATE_ID,
    sourceEventId: '01890000-0000-7000-8000-000000000005',
    traceId: null,
    templateKey: 'care_recommendation.created.v1',
    templateParameters: { ruleKey: 'observation_reminder', urgency: 'high' },
    priority: 'high',
    channelInApp: true,
    channelPush: true,
    deepLink: {
      kind: 'gardenToday',
      gardenId: GARDEN_ID,
      recommendationCandidateId: CANDIDATE_ID,
    },
    dedupKey: `care_recommendation:candidate:${CANDIDATE_ID}`,
    earliestDeliveryAt: NOW,
    expiresAt: new Date('2026-07-27T12:00:00Z'),
    state: 'pending',
    closeReason: null,
    nextDeliveryAttemptAt: null,
    deliveryAttemptCount: 0,
    readAt: null,
    dismissedAt: null,
    revision: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildFacts(overrides: Partial<SendTimeFacts> = {}): SendTimeFacts {
  return {
    intent: buildIntent(),
    recipient: { accountState: 'active', timeZone: 'UTC' },
    candidate: {
      id: CANDIDATE_ID,
      gardenId: GARDEN_ID,
      state: 'presented',
      windowEnd: new Date('2026-07-27T12:00:00Z'),
    },
    preferenceEntries: [],
    settings: UNWRITTEN_PREFERENCE_SETTINGS,
    hasActiveDevice: true,
    ...overrides,
  };
}

describe('decideSendTimeAction', () => {
  it('sends when every recheck passes', () => {
    expect(decideSendTimeAction(buildFacts(), NOW)).toEqual({ kind: 'send' });
  });

  it('expires a lapsed intent before any other consideration', () => {
    const facts = buildFacts({
      intent: buildIntent({ expiresAt: NOW }),
      // Even with everything else broken, expiry wins: the close is the
      // honest terminal fact regardless of access or preferences.
      recipient: null,
      candidate: null,
    });
    expect(decideSendTimeAction(facts, NOW)).toEqual({ kind: 'expire' });
  });

  it('skips when the recipient is no longer an active member — membership removal before delivery (section 16)', () => {
    const decision = decideSendTimeAction(buildFacts({ recipient: null }), NOW);
    expect(decision).toEqual({ kind: 'skip', reason: 'recipient_access_revoked' });
  });

  it('skips when the account is no longer usable', () => {
    const decision = decideSendTimeAction(
      buildFacts({ recipient: { accountState: 'suspended', timeZone: 'UTC' } }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'account_not_usable' });
  });

  it('skips a STALE intent: candidate superseded before delivery (section 16), typed candidate_not_live', () => {
    const decision = decideSendTimeAction(
      buildFacts({
        candidate: { id: CANDIDATE_ID, gardenId: GARDEN_ID, state: 'superseded', windowEnd: null },
      }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'candidate_not_live' });
  });

  it('skips a STALE intent: candidate acted on (completed) before delivery', () => {
    const decision = decideSendTimeAction(
      buildFacts({
        candidate: { id: CANDIDATE_ID, gardenId: GARDEN_ID, state: 'completed', windowEnd: null },
      }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'candidate_not_live' });
  });

  it('skips a STALE intent: candidate purged entirely — missing is an answer, never an error', () => {
    const decision = decideSendTimeAction(buildFacts({ candidate: null }), NOW);
    expect(decision).toEqual({ kind: 'skip', reason: 'candidate_missing' });
  });

  it('skips a STALE intent: candidate validity window passed while the intent itself has not', () => {
    const decision = decideSendTimeAction(
      buildFacts({
        candidate: { id: CANDIDATE_ID, gardenId: GARDEN_ID, state: 'presented', windowEnd: NOW },
      }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'candidate_window_passed' });
  });

  it('ignores candidate facts for a non-recommendation intent type', () => {
    const decision = decideSendTimeAction(
      buildFacts({
        intent: buildIntent({ intentType: 'some_future_type', recommendationCandidateId: null }),
        candidate: null,
      }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'send' });
  });

  it('skips when the CURRENT preference disables push — a garden override written after the intent counts', () => {
    const decision = decideSendTimeAction(
      buildFacts({
        preferenceEntries: [
          {
            notificationType: 'care_recommendation',
            gardenId: GARDEN_ID,
            inAppEnabled: true,
            pushEnabled: false,
          },
        ],
      }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'push_channel_disabled' });
  });

  it('defers, never skips, when quiet hours moved over now since creation — to the CURRENT window end in the override zone', () => {
    // 12:00Z is 21:00 in Tokyo; a 20:00-22:00 Tokyo window is quiet now.
    const decision = decideSendTimeAction(
      buildFacts({
        settings: {
          quietHours: { startMinute: 20 * 60, endMinute: 22 * 60 },
          quietHoursTimeZone: 'Asia/Tokyo',
          revision: 3,
        },
      }),
      NOW,
    );
    // 22:00 Tokyo = 13:00Z.
    expect(decision).toEqual({
      kind: 'defer',
      nextAttemptAt: new Date('2026-07-20T13:00:00Z'),
    });
  });

  it('evaluates quiet hours in the PROFILE zone when the preference document names none', () => {
    // The same window in the profile's own zone (UTC): 12:00Z is outside
    // 20:00-22:00 UTC, so no deferral — the zone fallback is load-bearing.
    const decision = decideSendTimeAction(
      buildFacts({
        recipient: { accountState: 'active', timeZone: 'UTC' },
        settings: {
          quietHours: { startMinute: 20 * 60, endMinute: 22 * 60 },
          quietHoursTimeZone: null,
          revision: 3,
        },
      }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'send' });
  });

  it('skips terminally when no active device exists — the next intent serves a later registration', () => {
    const decision = decideSendTimeAction(buildFacts({ hasActiveDevice: false }), NOW);
    expect(decision).toEqual({ kind: 'skip', reason: 'no_active_device' });
  });

  it('orders freshness before quiet hours: a stale candidate closes now instead of deferring into a doomed retry', () => {
    const decision = decideSendTimeAction(
      buildFacts({
        candidate: null,
        settings: {
          quietHours: { startMinute: 20 * 60, endMinute: 22 * 60 },
          quietHoursTimeZone: 'Asia/Tokyo',
          revision: 3,
        },
      }),
      NOW,
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'candidate_missing' });
  });
});

describe('buildPushMessageData', () => {
  it('carries identifiers and the rendering key only — no template parameters, no rendered text (section 8)', () => {
    const data = buildPushMessageData(buildIntent());

    expect(data).toEqual({
      notificationId: '01890000-0000-7000-8000-000000000001',
      notificationType: 'care_recommendation',
      templateKey: 'care_recommendation.created.v1',
      deepLinkKind: 'gardenToday',
      gardenId: GARDEN_ID,
      recommendationCandidateId: CANDIDATE_ID,
    });
    // FCM's data map is string-to-string; a non-string value would be a
    // transport defect.
    for (const value of Object.values(data)) {
      expect(typeof value).toBe('string');
    }
  });
});

describe('resolveTransientRetryAt', () => {
  it('doubles the delay per consumed round: 5, 10, 20, 40 minutes', () => {
    expect(resolveTransientRetryAt(1, NOW)).toEqual(
      new Date(NOW.getTime() + DELIVERY_RETRY_BASE_DELAY_MS),
    );
    expect(resolveTransientRetryAt(2, NOW)).toEqual(
      new Date(NOW.getTime() + 2 * DELIVERY_RETRY_BASE_DELAY_MS),
    );
    expect(resolveTransientRetryAt(4, NOW)).toEqual(
      new Date(NOW.getTime() + 8 * DELIVERY_RETRY_BASE_DELAY_MS),
    );
  });

  it('exhausts the budget at the documented ceiling', () => {
    expect(resolveTransientRetryAt(MAX_DELIVERY_ATTEMPTS, NOW)).toBeNull();
    expect(resolveTransientRetryAt(MAX_DELIVERY_ATTEMPTS + 1, NOW)).toBeNull();
  });
});
