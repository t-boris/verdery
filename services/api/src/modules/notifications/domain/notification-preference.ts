/**
 * Notification preference vocabulary and resolution (P7-NOTIF-01).
 *
 * Preferences support type, channel, and garden dimensions plus quiet
 * hours and a time zone (notifications.md section 7). The storage model is
 * explicit per-type entry rows — a garden-scoped row overrides the global
 * row, which overrides the default — and one per-profile document carrying
 * quiet hours, the optional zone override, and the document revision.
 *
 * DEFAULT: every channel enabled. No document names a default, so this is
 * the reasoned choice, stated once here: a notification type only exists
 * because the product decided its events matter to garden members, and an
 * opt-OUT model is what makes a preference row a real user decision rather
 * than a provisioning step every account must perform before notifications
 * work at all. Section 7's "Security and account-integrity notices may
 * have different opt-out rules" concerns types that do not exist yet; the
 * stage that adds one classifies it explicitly.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { QuietHours } from './quiet-hours.js';

/**
 * The server-owned notification type vocabulary — deliberately a code-level
 * constant, not a database CHECK (the `consent_type` posture: the set grows
 * with the product and a mistake here costs a code change, not a
 * migration). One type exists this stage.
 */
export const CARE_RECOMMENDATION_INTENT_TYPE = 'care_recommendation';

/**
 * P8-EXPORT-01: the requester's own export package completed. In-app
 * channel ONLY at this stage — data-export-and-deletion.md section 9's own
 * words are "The requester receives an in-app notification; email may be
 * added through the notification adapter", and no document grants exports
 * a push channel, so the policy pins `channelPush` false rather than
 * routing a security-adjacent "your data is packaged" event through a
 * transport nothing specified.
 */
export const EXPORT_READY_INTENT_TYPE = 'export_ready';

export const KNOWN_NOTIFICATION_TYPES: readonly string[] = [
  CARE_RECOMMENDATION_INTENT_TYPE,
  EXPORT_READY_INTENT_TYPE,
];

export function isKnownNotificationType(value: string): boolean {
  return KNOWN_NOTIFICATION_TYPES.includes(value);
}

/** Per-channel enablement for one notification type in one scope. */
export interface ChannelPreference {
  readonly inAppEnabled: boolean;
  readonly pushEnabled: boolean;
}

export const DEFAULT_CHANNEL_PREFERENCE: ChannelPreference = {
  inAppEnabled: true,
  pushEnabled: true,
};

/** One stored preference entry. `gardenId: null` is the profile's global setting for the type. */
export interface NotificationPreferenceEntry {
  readonly notificationType: string;
  readonly gardenId: Uuid | null;
  readonly inAppEnabled: boolean;
  readonly pushEnabled: boolean;
}

/** The per-profile preference document: quiet hours plus the optional zone override (`null` = the profile's own time zone applies). */
export interface NotificationPreferenceSettings {
  readonly quietHours: QuietHours | null;
  readonly quietHoursTimeZone: string | null;
  readonly revision: number;
}

/** The settings of a profile that has never written preferences — revision 0, everything default. */
export const UNWRITTEN_PREFERENCE_SETTINGS: NotificationPreferenceSettings = {
  quietHours: null,
  quietHoursTimeZone: null,
  revision: 0,
};

/**
 * Resolves the effective channel preference for one type in one garden:
 * the garden-scoped entry when present, else the global entry, else the
 * default. Entries for other types or other gardens never apply.
 * `gardenId: null` (an account-level intent, P8-EXPORT-01) resolves the
 * global entry directly — a garden-scoped override can never apply to an
 * intent that concerns no garden.
 */
export function resolveChannelPreference(
  entries: readonly NotificationPreferenceEntry[],
  notificationType: string,
  gardenId: Uuid | null,
): ChannelPreference {
  const applicable = entries.filter((entry) => entry.notificationType === notificationType);

  const gardenEntry =
    gardenId === null ? undefined : applicable.find((entry) => entry.gardenId === gardenId);
  if (gardenEntry !== undefined) {
    return { inAppEnabled: gardenEntry.inAppEnabled, pushEnabled: gardenEntry.pushEnabled };
  }

  const globalEntry = applicable.find((entry) => entry.gardenId === null);
  if (globalEntry !== undefined) {
    return { inAppEnabled: globalEntry.inAppEnabled, pushEnabled: globalEntry.pushEnabled };
  }

  return DEFAULT_CHANNEL_PREFERENCE;
}
