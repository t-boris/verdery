/**
 * Port for the module's own `notifications.notification_device` rows
 * (P7-NOTIF-02) — the revocable device-channel records of
 * notifications.md section 6.
 *
 * `registerOrRefresh` is last-writer-wins by design (the sync
 * client-installation precedent): the upsert key is
 * (profile, installation), a refresh always reactivates, and any OTHER
 * row holding the same token is deleted in the same transaction — a
 * registration token identifies one installation at the provider, so a
 * re-registration under a new profile (account switch on one physical
 * device) must displace the old profile's record, structurally enforced
 * by the unique token index.
 *
 * `disable` is the idempotent invalid-token close ("Invalid or
 * unregistered tokens are disabled idempotently"): a repeat call on an
 * already-disabled row is a counted no-op, never an error.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  NotificationDevice,
  NotificationDevicePlatform,
} from '../domain/notification-device.js';

/** Everything a registration writes; storage stamps status `active` and the timestamps. */
export interface NotificationDeviceRegistration {
  /** Used only when the registration CREATES a row; a refresh keeps the stored id. */
  readonly id: Uuid;
  readonly profileId: Uuid;
  readonly installationId: Uuid;
  readonly platform: NotificationDevicePlatform;
  readonly provider: string;
  readonly fcmToken: string;
  readonly environment: string;
}

export interface NotificationDeviceRepository {
  /** Upserts by (profile, installation), reactivating and re-stamping `lastSeenAt`; deletes other holders of the same token first (see the header). */
  registerOrRefresh(
    registration: NotificationDeviceRegistration,
    now: Date,
  ): Promise<NotificationDevice>;

  /** Deletes the caller's own record for the installation. Returns whether a row existed — an absent record converges to the same end state. */
  remove(profileId: Uuid, installationId: Uuid): Promise<boolean>;

  /** The delivery worker's per-recipient read: `active` records only. */
  listActiveForProfile(profileId: Uuid): Promise<readonly NotificationDevice[]>;

  /** Disables one device with a typed reason — idempotent (`WHERE status = 'active'`). Returns whether this call transitioned the row. */
  disable(deviceId: Uuid, reason: string, now: Date): Promise<boolean>;
}
