import type { Generated } from 'kysely';

/**
 * Row types for the `notifications` schema
 * (1786000000000_notifications-baseline.sql, extended by
 * 1786200000000_notification-delivery.sql). `revision` columns are plain
 * `integer`, read back as JS numbers with no custom type parser — the
 * `plants_inventory.plant.revision` note. `template_parameters` and
 * `deep_link` are `jsonb`, typed `unknown` and narrowed by the repository
 * (only this module's own policy writes them).
 */
export interface NotificationIntentRow {
  id: string;
  intent_type: string;
  intent_version: Generated<number>;
  recipient_profile_id: string;
  garden_id: string;
  recommendation_candidate_id: string | null;
  source_event_id: string;
  trace_id: string | null;
  template_key: string;
  template_parameters: unknown;
  priority: string;
  channel_in_app: boolean;
  channel_push: boolean;
  deep_link: unknown;
  dedup_key: string;
  earliest_delivery_at: Date;
  expires_at: Date;
  state: Generated<string>;
  close_reason: Generated<string | null>;
  next_delivery_attempt_at: Generated<Date | null>;
  delivery_attempt_count: Generated<number>;
  read_at: Date | null;
  dismissed_at: Date | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** P7-NOTIF-02: one revocable device-channel record per (profile, installation) — the token column is a secret, never logged or echoed. */
export interface NotificationDeviceRow {
  id: string;
  profile_id: string;
  installation_id: string;
  platform: string;
  provider: string;
  fcm_token: string;
  environment: string;
  status: Generated<string>;
  disabled_reason: Generated<string | null>;
  last_seen_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** P7-NOTIF-02: append-only FCM send-attempt records — insert-only, no updates ever. */
export interface NotificationDeliveryAttemptRow {
  id: string;
  intent_id: string;
  device_id: string;
  outcome: string;
  error_code: string | null;
  attempted_at: Date;
  created_at: Generated<Date>;
}

export interface NotificationPreferenceRow {
  id: string;
  profile_id: string;
  garden_id: string | null;
  notification_type: string;
  in_app_enabled: boolean;
  push_enabled: boolean;
  created_at: Generated<Date>;
}

/** `smallint` columns read back as JS numbers through pg's default int2 parser. */
export interface NotificationPreferenceDocumentRow {
  profile_id: string;
  quiet_hours_start_minute: number | null;
  quiet_hours_end_minute: number | null;
  quiet_hours_time_zone: string | null;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface NotificationsDatabaseSchema {
  'notifications.notification_intent': NotificationIntentRow;
  'notifications.notification_preference': NotificationPreferenceRow;
  'notifications.notification_preference_document': NotificationPreferenceDocumentRow;
  'notifications.notification_device': NotificationDeviceRow;
  'notifications.notification_delivery_attempt': NotificationDeliveryAttemptRow;
}
