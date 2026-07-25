/**
 * Kysely implementation of `NotificationDeviceRepository` (P7-NOTIF-02).
 *
 * `registerOrRefresh` runs two statements the caller binds to one
 * transaction: displace any OTHER holder of the token (the unique token
 * index makes a stale holder a hard conflict otherwise), then upsert by
 * the (profile, installation) key — always reactivating, because a fresh
 * registration proves the channel works. `disable` is the idempotent
 * invalid-token close: `WHERE status = 'active'` makes a repeat verdict a
 * counted no-op, the intent repository's state-conditional posture.
 */

import type { Kysely, Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  NotificationDevice,
  NotificationDevicePlatform,
  NotificationDeviceStatus,
} from '../domain/notification-device.js';
import type {
  NotificationDeviceRegistration,
  NotificationDeviceRepository,
} from '../application/notification-device-repository.js';
import type { NotificationDeviceRow } from './schema.js';

function toDevice(row: Selectable<NotificationDeviceRow>): NotificationDevice {
  return {
    id: row.id,
    profileId: row.profile_id,
    installationId: row.installation_id,
    platform: row.platform as NotificationDevicePlatform,
    provider: row.provider,
    fcmToken: row.fcm_token,
    environment: row.environment,
    status: row.status as NotificationDeviceStatus,
    disabledReason: row.disabled_reason,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyNotificationDeviceRepository implements NotificationDeviceRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async registerOrRefresh(
    registration: NotificationDeviceRegistration,
    now: Date,
  ): Promise<NotificationDevice> {
    // A registration token identifies ONE installation at the provider:
    // any other row holding it (account switch on the same physical
    // device, or a reinstalled app under a new installation id) is
    // displaced outright — see the port's header.
    await this.db
      .deleteFrom('notifications.notification_device')
      .where('fcm_token', '=', registration.fcmToken)
      .where((eb) =>
        eb.or([
          eb('profile_id', '!=', registration.profileId),
          eb('installation_id', '!=', registration.installationId),
        ]),
      )
      .execute();

    const row = await this.db
      .insertInto('notifications.notification_device')
      .values({
        id: registration.id,
        profile_id: registration.profileId,
        installation_id: registration.installationId,
        platform: registration.platform,
        provider: registration.provider,
        fcm_token: registration.fcmToken,
        environment: registration.environment,
        status: 'active',
        disabled_reason: null,
        last_seen_at: now,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.columns(['profile_id', 'installation_id']).doUpdateSet({
          platform: registration.platform,
          provider: registration.provider,
          fcm_token: registration.fcmToken,
          environment: registration.environment,
          status: 'active',
          disabled_reason: null,
          last_seen_at: now,
          updated_at: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return toDevice(row);
  }

  async remove(profileId: Uuid, installationId: Uuid): Promise<boolean> {
    const result = await this.db
      .deleteFrom('notifications.notification_device')
      .where('profile_id', '=', profileId)
      .where('installation_id', '=', installationId)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  async listActiveForProfile(profileId: Uuid): Promise<readonly NotificationDevice[]> {
    const rows = await this.db
      .selectFrom('notifications.notification_device')
      .selectAll()
      .where('profile_id', '=', profileId)
      .where('status', '=', 'active')
      .orderBy('id')
      .execute();

    return rows.map(toDevice);
  }

  async disable(deviceId: Uuid, reason: string, now: Date): Promise<boolean> {
    const result = await this.db
      .updateTable('notifications.notification_device')
      .set({ status: 'disabled', disabled_reason: reason, updated_at: now })
      .where('id', '=', deviceId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }
}
