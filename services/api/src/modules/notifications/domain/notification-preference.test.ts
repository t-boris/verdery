import { describe, expect, it } from 'vitest';
import type { NotificationPreferenceEntry } from './notification-preference.js';
import {
  CARE_RECOMMENDATION_INTENT_TYPE,
  DEFAULT_CHANNEL_PREFERENCE,
  isKnownNotificationType,
  resolveChannelPreference,
} from './notification-preference.js';

const GARDEN = '01890000-0000-7000-8000-00000000000a';
const OTHER_GARDEN = '01890000-0000-7000-8000-00000000000b';

function entry(overrides: Partial<NotificationPreferenceEntry>): NotificationPreferenceEntry {
  return {
    notificationType: CARE_RECOMMENDATION_INTENT_TYPE,
    gardenId: null,
    inAppEnabled: true,
    pushEnabled: true,
    ...overrides,
  };
}

describe('isKnownNotificationType', () => {
  it('accepts the launch vocabulary and rejects anything else', () => {
    expect(isKnownNotificationType(CARE_RECOMMENDATION_INTENT_TYPE)).toBe(true);
    expect(isKnownNotificationType('surprise_type')).toBe(false);
  });
});

describe('resolveChannelPreference', () => {
  it('defaults to every channel enabled when no entry applies', () => {
    expect(resolveChannelPreference([], CARE_RECOMMENDATION_INTENT_TYPE, GARDEN)).toEqual(
      DEFAULT_CHANNEL_PREFERENCE,
    );
  });

  it('applies the global entry when no garden entry exists', () => {
    const entries = [entry({ pushEnabled: false })];
    expect(resolveChannelPreference(entries, CARE_RECOMMENDATION_INTENT_TYPE, GARDEN)).toEqual({
      inAppEnabled: true,
      pushEnabled: false,
    });
  });

  it('lets a garden-scoped entry override the global entry for its garden only', () => {
    const entries = [
      entry({ inAppEnabled: false, pushEnabled: false }),
      entry({ gardenId: GARDEN, inAppEnabled: true, pushEnabled: true }),
    ];
    expect(resolveChannelPreference(entries, CARE_RECOMMENDATION_INTENT_TYPE, GARDEN)).toEqual({
      inAppEnabled: true,
      pushEnabled: true,
    });
    // The other garden still resolves through the global row.
    expect(
      resolveChannelPreference(entries, CARE_RECOMMENDATION_INTENT_TYPE, OTHER_GARDEN),
    ).toEqual({ inAppEnabled: false, pushEnabled: false });
  });

  it('ignores entries for other notification types entirely', () => {
    const entries = [
      entry({ notificationType: 'another_type', inAppEnabled: false, pushEnabled: false }),
    ];
    expect(resolveChannelPreference(entries, CARE_RECOMMENDATION_INTENT_TYPE, GARDEN)).toEqual(
      DEFAULT_CHANNEL_PREFERENCE,
    );
  });
});
