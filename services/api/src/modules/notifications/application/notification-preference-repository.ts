/**
 * Port for the module's preference storage (P7-NOTIF-01): explicit
 * per-type entry rows (`notifications.notification_preference`) plus the
 * per-profile document row carrying quiet hours, the zone override, and
 * the document revision (`notifications.notification_preference_document`).
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  NotificationPreferenceEntry,
  NotificationPreferenceSettings,
} from '../domain/notification-preference.js';
import type { QuietHours } from '../domain/quiet-hours.js';

/** The replacement document a `PUT` writes — everything but the revision, which the store derives. */
export interface PreferenceDocumentReplacement {
  readonly quietHours: QuietHours | null;
  readonly quietHoursTimeZone: string | null;
  readonly entries: readonly NotificationPreferenceEntry[];
}

export interface NotificationPreferenceRepository {
  /** The profile's document settings; `UNWRITTEN_PREFERENCE_SETTINGS` (revision 0) when none was ever written. */
  getSettings(profileId: Uuid): Promise<NotificationPreferenceSettings>;

  /** Every explicit entry the profile stored, global and garden-scoped. */
  listEntries(profileId: Uuid): Promise<readonly NotificationPreferenceEntry[]>;

  /** Batch form of `getSettings` for the policy's recipient fan-out; profiles without a document are simply absent from the map. */
  getSettingsForProfiles(
    profileIds: readonly Uuid[],
  ): Promise<ReadonlyMap<Uuid, NotificationPreferenceSettings>>;

  /** Batch entry read for one notification type; profiles without entries are absent from the map. */
  listEntriesForProfiles(
    profileIds: readonly Uuid[],
    notificationType: string,
  ): Promise<ReadonlyMap<Uuid, readonly NotificationPreferenceEntry[]>>;

  /**
   * Replaces the profile's whole document — settings row and every entry —
   * guarded by the document revision (`0` = never written; the insert path
   * uses `ON CONFLICT DO NOTHING` so a concurrent first write surfaces as
   * a clean revision mismatch, never an aborted transaction). Returns the
   * new revision, or `null` on a revision mismatch.
   */
  replaceDocument(
    profileId: Uuid,
    expectedRevision: number,
    replacement: PreferenceDocumentReplacement,
    now: Date,
  ): Promise<number | null>;
}
