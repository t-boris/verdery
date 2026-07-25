/**
 * Kysely implementation of `NotificationPreferenceRepository` (P7-NOTIF-01).
 *
 * The document replacement is the port's own revision contract: a first
 * write (`expectedRevision === 0`) inserts `ON CONFLICT DO NOTHING` so a
 * concurrent first write surfaces as a clean `null` (revision mismatch)
 * instead of an aborted transaction; a later write is a revision-guarded
 * UPDATE. Either way the winner holds the document row's lock while its
 * entry rows are replaced, so entry replacement can never interleave
 * between two writers.
 */

import { sql, type Kysely, type Selectable } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { generateUuidV7, type Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  NotificationPreferenceEntry,
  NotificationPreferenceSettings,
} from '../domain/notification-preference.js';
import { UNWRITTEN_PREFERENCE_SETTINGS } from '../domain/notification-preference.js';
import type {
  NotificationPreferenceRepository,
  PreferenceDocumentReplacement,
} from '../application/notification-preference-repository.js';
import type { NotificationPreferenceDocumentRow, NotificationPreferenceRow } from './schema.js';

function toSettings(
  row: Selectable<NotificationPreferenceDocumentRow>,
): NotificationPreferenceSettings {
  return {
    quietHours:
      row.quiet_hours_start_minute === null || row.quiet_hours_end_minute === null
        ? null
        : { startMinute: row.quiet_hours_start_minute, endMinute: row.quiet_hours_end_minute },
    quietHoursTimeZone: row.quiet_hours_time_zone,
    revision: row.revision,
  };
}

function toEntry(row: Selectable<NotificationPreferenceRow>): NotificationPreferenceEntry {
  return {
    notificationType: row.notification_type,
    gardenId: row.garden_id,
    inAppEnabled: row.in_app_enabled,
    pushEnabled: row.push_enabled,
  };
}

export class KyselyNotificationPreferenceRepository implements NotificationPreferenceRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async getSettings(profileId: Uuid): Promise<NotificationPreferenceSettings> {
    const row = await this.db
      .selectFrom('notifications.notification_preference_document')
      .selectAll()
      .where('profile_id', '=', profileId)
      .executeTakeFirst();

    return row === undefined ? UNWRITTEN_PREFERENCE_SETTINGS : toSettings(row);
  }

  async listEntries(profileId: Uuid): Promise<readonly NotificationPreferenceEntry[]> {
    const rows = await this.db
      .selectFrom('notifications.notification_preference')
      .selectAll()
      .where('profile_id', '=', profileId)
      .orderBy('notification_type')
      .orderBy('garden_id')
      .execute();

    return rows.map(toEntry);
  }

  async getSettingsForProfiles(
    profileIds: readonly Uuid[],
  ): Promise<ReadonlyMap<Uuid, NotificationPreferenceSettings>> {
    if (profileIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .selectFrom('notifications.notification_preference_document')
      .selectAll()
      .where('profile_id', 'in', [...profileIds])
      .execute();

    return new Map(rows.map((row) => [row.profile_id, toSettings(row)]));
  }

  async listEntriesForProfiles(
    profileIds: readonly Uuid[],
    notificationType: string,
  ): Promise<ReadonlyMap<Uuid, readonly NotificationPreferenceEntry[]>> {
    if (profileIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .selectFrom('notifications.notification_preference')
      .selectAll()
      .where('profile_id', 'in', [...profileIds])
      .where('notification_type', '=', notificationType)
      .execute();

    const byProfile = new Map<Uuid, NotificationPreferenceEntry[]>();
    for (const row of rows) {
      const entries = byProfile.get(row.profile_id) ?? [];
      entries.push(toEntry(row));
      byProfile.set(row.profile_id, entries);
    }
    return byProfile;
  }

  async replaceDocument(
    profileId: Uuid,
    expectedRevision: number,
    replacement: PreferenceDocumentReplacement,
    now: Date,
  ): Promise<number | null> {
    const settingsColumns = {
      quiet_hours_start_minute: replacement.quietHours?.startMinute ?? null,
      quiet_hours_end_minute: replacement.quietHours?.endMinute ?? null,
      quiet_hours_time_zone: replacement.quietHoursTimeZone,
    };

    let revision: number | null;

    if (expectedRevision === 0) {
      const inserted = await this.db
        .insertInto('notifications.notification_preference_document')
        .values({
          profile_id: profileId,
          ...settingsColumns,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) => oc.column('profile_id').doNothing())
        .returning('revision')
        .executeTakeFirst();
      revision = inserted?.revision ?? null;
    } else {
      const updated = await this.db
        .updateTable('notifications.notification_preference_document')
        .set({
          ...settingsColumns,
          revision: sql`revision + 1`,
          updated_at: now,
        })
        .where('profile_id', '=', profileId)
        .where('revision', '=', expectedRevision)
        .returning('revision')
        .executeTakeFirst();
      revision = updated?.revision ?? null;
    }

    if (revision === null) {
      return null;
    }

    await this.db
      .deleteFrom('notifications.notification_preference')
      .where('profile_id', '=', profileId)
      .execute();

    if (replacement.entries.length > 0) {
      await this.db
        .insertInto('notifications.notification_preference')
        .values(
          replacement.entries.map((entry) => ({
            id: generateUuidV7(),
            profile_id: profileId,
            garden_id: entry.gardenId,
            notification_type: entry.notificationType,
            in_app_enabled: entry.inAppEnabled,
            push_enabled: entry.pushEnabled,
            created_at: now,
          })),
        )
        .execute();
    }

    return revision;
  }
}
