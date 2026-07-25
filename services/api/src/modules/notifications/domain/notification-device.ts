/**
 * The device-channel record (P7-NOTIF-02) — notifications.md section 6:
 * one revocable record per (profile, application installation) carrying
 * the FCM registration token, platform, environment, last-seen time,
 * status, and provider metadata.
 *
 * The token is a SECRET (section 6): it never appears in logs, analytics,
 * or any HTTP response — the contract's `NotificationDevice` resource
 * deliberately omits it, and every log line in this module's delivery path
 * carries device ids and counts only.
 *
 * Lifecycle: register-or-refresh upserts by (profile, installation) and
 * always reactivates — a fresh token means the channel provably works
 * again; invalid/unregistered provider verdicts disable the record
 * idempotently with a typed reason; the user-facing removal deletes it.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';

/** The two application platforms this API serves — the `SyncClientPlatform` vocabulary. */
export type NotificationDevicePlatform = 'ios' | 'web';

export const NOTIFICATION_DEVICE_PLATFORMS: readonly NotificationDevicePlatform[] = ['ios', 'web'];

export function isNotificationDevicePlatform(value: string): value is NotificationDevicePlatform {
  return (NOTIFICATION_DEVICE_PLATFORMS as readonly string[]).includes(value);
}

export type NotificationDeviceStatus = 'active' | 'disabled';

/**
 * The one push provider this stage integrates (ADR-0002 commits Firebase);
 * stored per record as provider metadata so a future transport arrives as
 * data, not a schema change.
 */
export const NOTIFICATION_DEVICE_PROVIDER_FCM = 'fcm';

/** Why a device channel was disabled: the provider reported the token invalid or unregistered (section 6's idempotent-disable rule). */
export const DEVICE_DISABLED_REASON_TOKEN_INVALID = 'token_invalid';

export interface NotificationDevice {
  readonly id: Uuid;
  readonly profileId: Uuid;
  /** Client-minted UUID, stable for one app installation on one device — the sync-client-installation precedent. */
  readonly installationId: Uuid;
  readonly platform: NotificationDevicePlatform;
  readonly provider: string;
  readonly fcmToken: string;
  /** The deployment environment the registering API stamped from its own configuration. */
  readonly environment: string;
  readonly status: NotificationDeviceStatus;
  readonly disabledReason: string | null;
  readonly lastSeenAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
