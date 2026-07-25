/**
 * Device-registration commands (P7-NOTIF-02) — the contract operations
 * behind `PUT`/`DELETE /notification-devices/{deviceInstallationId}`.
 *
 * Both are idempotent BY DESIGN, deliberately outside the
 * Idempotency-Key convention — the inbox read/dismiss reasoning applied
 * to registration: register-or-refresh is a last-writer-wins upsert on a
 * single-owner row (a retry or concurrent duplicate converges on
 * identical stored state and an identical `200` response), and removal
 * of an absent record is the same end state as removal of a present one
 * (`204` either way). An idempotency record would duplicate what the
 * writes already guarantee. This differs from `RegisterSyncClient` (which
 * keeps a key) only because that operation's 200-versus-201 distinction
 * is response state a bare retry cannot reproduce; device registration
 * deliberately has no created-versus-refreshed split to preserve.
 *
 * The response resource NEVER carries the token — tokens are secrets
 * (notifications.md section 6) — and neither command logs one.
 *
 * The stored `environment` is stamped from the API's own configuration,
 * never accepted from the client: a device record is scoped to the
 * environment that issued it, and clients cannot claim another
 * environment's channel.
 */

import { generateUuidV7, type Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  NotificationDevice,
  NotificationDevicePlatform,
} from '../domain/notification-device.js';
import { NOTIFICATION_DEVICE_PROVIDER_FCM } from '../domain/notification-device.js';
import type { NotificationDeviceRepository } from './notification-device-repository.js';
import type { NotificationsUnitOfWork } from './notifications-unit-of-work.js';

export interface RegisterNotificationDeviceInput {
  readonly platform: NotificationDevicePlatform;
  readonly fcmToken: string;
}

/** The contract's `NotificationDevice` — deliberately token-free. */
export interface NotificationDeviceResource {
  readonly installationId: Uuid;
  readonly platform: NotificationDevicePlatform;
  readonly status: NotificationDevice['status'];
  readonly lastSeenAt: string;
  readonly registeredAt: string;
}

function toResource(device: NotificationDevice): NotificationDeviceResource {
  return {
    installationId: device.installationId,
    platform: device.platform,
    status: device.status,
    lastSeenAt: device.lastSeenAt.toISOString(),
    registeredAt: device.createdAt.toISOString(),
  };
}

export class RegisterNotificationDevice {
  constructor(
    private readonly unitOfWork: NotificationsUnitOfWork,
    private readonly clock: Clock,
    /** The API's own deployment environment — see the header. */
    private readonly environment: string,
  ) {}

  async execute(
    profileId: Uuid,
    installationId: Uuid,
    input: RegisterNotificationDeviceInput,
  ): Promise<NotificationDeviceResource> {
    const now = this.clock.now();

    // One transaction: displacing another record that holds the same token
    // and upserting this one must commit together, or the unique token
    // index turns an account switch into a spurious failure.
    const device = await this.unitOfWork.run((context) =>
      context.devices.registerOrRefresh(
        {
          id: generateUuidV7(),
          profileId,
          installationId,
          platform: input.platform,
          provider: NOTIFICATION_DEVICE_PROVIDER_FCM,
          fcmToken: input.fcmToken,
          environment: this.environment,
        },
        now,
      ),
    );

    return toResource(device);
  }
}

export class RemoveNotificationDevice {
  constructor(private readonly devices: NotificationDeviceRepository) {}

  /** Single-statement delete on the pooled adapter — no transaction to coordinate. Converges whether or not a record existed. */
  async execute(profileId: Uuid, installationId: Uuid): Promise<void> {
    await this.devices.remove(profileId, installationId);
  }
}
