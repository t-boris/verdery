/**
 * Notification policy tests (P7-NOTIF-01) — the work package's named
 * acceptance evidence, at the policy's own pure layer: freshness/expiry
 * classification, dedup key identity, priority mapping, deep-link shape,
 * and the per-recipient decision (account state, channels, quiet hours in
 * the recipient's own zone).
 */

import { describe, expect, it } from 'vitest';
import type { CandidateFreshnessFacts, RecipientPolicyInput } from './notification-policy.js';
import {
  assessCareRecommendationEvent,
  buildCareRecommendationDedupKey,
  buildCareRecommendationDeepLink,
  CARE_RECOMMENDATION_DEFAULT_TTL_MS,
  derivePriorityFromUrgency,
  evaluateRecipientPolicy,
} from './notification-policy.js';

const NOW = new Date('2026-07-20T12:00:00Z');
const CANDIDATE = '01890000-0000-7000-8000-000000000001';
const GARDEN = '01890000-0000-7000-8000-000000000002';
const PROFILE = '01890000-0000-7000-8000-000000000003';

function candidate(overrides: Partial<CandidateFreshnessFacts> = {}): CandidateFreshnessFacts {
  return {
    id: CANDIDATE,
    gardenId: GARDEN,
    state: 'eligible',
    windowEnd: new Date('2026-07-25T12:00:00Z'),
    ...overrides,
  };
}

function recipient(overrides: Partial<RecipientPolicyInput> = {}): RecipientPolicyInput {
  return {
    profileId: PROFILE,
    accountState: 'active',
    profileTimeZone: 'UTC',
    channels: { inAppEnabled: true, pushEnabled: true },
    quietHours: null,
    quietHoursTimeZone: null,
    ...overrides,
  };
}

describe('assessCareRecommendationEvent', () => {
  it('takes the candidate validity-window end as the intent expiry', () => {
    const assessment = assessCareRecommendationEvent(candidate(), NOW);
    expect(assessment).toEqual({ kind: 'actionable', expiresAt: new Date('2026-07-25T12:00:00Z') });
  });

  it('falls back to the documented TTL when the candidate declares no window end', () => {
    const assessment = assessCareRecommendationEvent(candidate({ windowEnd: null }), NOW);
    expect(assessment).toEqual({
      kind: 'actionable',
      expiresAt: new Date(NOW.getTime() + CARE_RECOMMENDATION_DEFAULT_TTL_MS),
    });
  });

  it('suppresses a purged candidate as missing', () => {
    expect(assessCareRecommendationEvent(null, NOW)).toEqual({
      kind: 'suppress',
      reason: 'candidate_missing',
    });
  });

  it('suppresses every non-live candidate state — the superseded-before-delivery case included', () => {
    for (const state of ['completed', 'postponed', 'rejected', 'superseded', 'expired']) {
      expect(assessCareRecommendationEvent(candidate({ state }), NOW)).toEqual({
        kind: 'suppress',
        reason: 'candidate_not_live',
      });
    }
    // A presented candidate is still live and still worth an inbox entry.
    expect(assessCareRecommendationEvent(candidate({ state: 'presented' }), NOW).kind).toBe(
      'actionable',
    );
  });

  it('suppresses a candidate whose validity window already passed — the stale-backlog drain case', () => {
    expect(
      assessCareRecommendationEvent(
        candidate({ windowEnd: new Date('2026-07-20T11:59:00Z') }),
        NOW,
      ),
    ).toEqual({ kind: 'suppress', reason: 'candidate_window_passed' });
    // Boundary: a window ending exactly now is already passed.
    expect(assessCareRecommendationEvent(candidate({ windowEnd: NOW }), NOW)).toEqual({
      kind: 'suppress',
      reason: 'candidate_window_passed',
    });
  });
});

describe('buildCareRecommendationDedupKey', () => {
  it('is a pure function of the candidate identity — replays collapse, distinct candidates never do', () => {
    expect(buildCareRecommendationDedupKey(CANDIDATE)).toBe(
      buildCareRecommendationDedupKey(CANDIDATE),
    );
    expect(buildCareRecommendationDedupKey(CANDIDATE)).not.toBe(
      buildCareRecommendationDedupKey(GARDEN),
    );
    expect(buildCareRecommendationDedupKey(CANDIDATE)).toContain(CANDIDATE);
  });
});

describe('derivePriorityFromUrgency', () => {
  it('maps urgent and high to high, everything else to normal', () => {
    expect(derivePriorityFromUrgency('urgent')).toBe('high');
    expect(derivePriorityFromUrgency('high')).toBe('high');
    expect(derivePriorityFromUrgency('normal')).toBe('normal');
    expect(derivePriorityFromUrgency('low')).toBe('normal');
    expect(derivePriorityFromUrgency('anything_else')).toBe('normal');
  });
});

describe('buildCareRecommendationDeepLink', () => {
  it('references the Today route by resource ids only — no bearer material', () => {
    expect(buildCareRecommendationDeepLink(GARDEN, CANDIDATE)).toEqual({
      kind: 'gardenToday',
      gardenId: GARDEN,
      recommendationCandidateId: CANDIDATE,
    });
  });
});

describe('evaluateRecipientPolicy', () => {
  it('creates an immediately deliverable intent for an unrestricted recipient', () => {
    expect(evaluateRecipientPolicy(recipient(), NOW)).toEqual({
      kind: 'create',
      channelInApp: true,
      channelPush: true,
      earliestDeliveryAt: NOW,
    });
  });

  it('suppresses recipients whose account is not usable', () => {
    for (const accountState of [
      'pending',
      'suspended',
      'deletion_requested',
      'disabled',
      'purged',
    ] as const) {
      expect(evaluateRecipientPolicy(recipient({ accountState }), NOW)).toEqual({
        kind: 'suppress',
        reason: 'account_not_usable',
      });
    }
  });

  it('suppresses when every channel is disabled', () => {
    expect(
      evaluateRecipientPolicy(
        recipient({ channels: { inAppEnabled: false, pushEnabled: false } }),
        NOW,
      ),
    ).toEqual({ kind: 'suppress', reason: 'channels_disabled' });
  });

  it('carries partial channel eligibility onto the intent', () => {
    const inAppOnly = evaluateRecipientPolicy(
      recipient({ channels: { inAppEnabled: true, pushEnabled: false } }),
      NOW,
    );
    expect(inAppOnly).toEqual({
      kind: 'create',
      channelInApp: true,
      channelPush: false,
      earliestDeliveryAt: NOW,
    });

    const pushOnly = evaluateRecipientPolicy(
      recipient({ channels: { inAppEnabled: false, pushEnabled: true } }),
      NOW,
    );
    expect(pushOnly.kind).toBe('create');
    if (pushOnly.kind === 'create') {
      expect(pushOnly.channelInApp).toBe(false);
      expect(pushOnly.channelPush).toBe(true);
    }
  });

  it('defers push past quiet hours in the PROFILE zone when no override exists', () => {
    // 12:00Z is 21:00 in Tokyo — inside 20:00-08:00 quiet hours; next end
    // is 08:00 Tokyo tomorrow = 23:00Z today.
    const decision = evaluateRecipientPolicy(
      recipient({
        profileTimeZone: 'Asia/Tokyo',
        quietHours: { startMinute: 20 * 60, endMinute: 8 * 60 },
      }),
      NOW,
    );
    expect(decision).toEqual({
      kind: 'create',
      channelInApp: true,
      channelPush: true,
      earliestDeliveryAt: new Date('2026-07-20T23:00:00Z'),
    });
  });

  it('lets the preference zone override the profile zone', () => {
    // Same window, but the override zone is Berlin where 12:00Z is 14:00
    // local — outside quiet hours entirely.
    const decision = evaluateRecipientPolicy(
      recipient({
        profileTimeZone: 'Asia/Tokyo',
        quietHours: { startMinute: 20 * 60, endMinute: 8 * 60 },
        quietHoursTimeZone: 'Europe/Berlin',
      }),
      NOW,
    );
    expect(decision).toEqual({
      kind: 'create',
      channelInApp: true,
      channelPush: true,
      earliestDeliveryAt: NOW,
    });
  });

  it('ignores quiet hours entirely for an in-app-only recipient — the inbox is never delayed', () => {
    const decision = evaluateRecipientPolicy(
      recipient({
        profileTimeZone: 'Asia/Tokyo',
        channels: { inAppEnabled: true, pushEnabled: false },
        quietHours: { startMinute: 20 * 60, endMinute: 8 * 60 },
      }),
      NOW,
    );
    expect(decision).toEqual({
      kind: 'create',
      channelInApp: true,
      channelPush: false,
      earliestDeliveryAt: NOW,
    });
  });
});
