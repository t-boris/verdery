/**
 * Migration tests for the media lifecycle and quotas extension: every new
 * and altered `media.media_record` column and CHECK constraint, the new
 * `media.quota_reservation` table, and confirmation that the three
 * pre-existing foreign keys into `media.media_record`
 * (`plants_inventory.plant_photo.media_id`,
 * `observations_history.observation_photo.media_id`,
 * `tasks_recommendations.task_attachment.media_id`) still work against the
 * grown table.
 *
 * Source: implementation-plan.md work package P6-DATA-01;
 *         architecture/testing-strategy.md, section
 *         "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media lifecycle and quotas migration';

const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';

const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();

if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

async function migrate(databaseUrl: string, direction: 'up' | 'down'): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIRECTORY,
    direction,
    migrationsTable: 'pgmigrations',
    count: Number.POSITIVE_INFINITY,
    log: () => {},
  });
}

type Row = Record<string, unknown>;

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;
  let gardenId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertRow(table: string, row: Row): Promise<string> {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return row['id'] as string;
  }

  function withId(row: Row): Row {
    return { id: randomUUID(), ...row };
  }

  async function freshFoundation(): Promise<void> {
    profileId = randomUUID();
    gardenId = randomUUID();

    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
  }

  const insertMediaRecord = (overrides: Row = {}) =>
    insertRow(
      'media.media_record',
      withId({
        uploaded_by_profile_id: profileId,
        media_class: 'garden_photo',
        display_filename: 'photo.jpg',
        declared_content_type: 'image/jpeg',
        declared_byte_size: 123_456,
        sensitivity_classification: 'standard',
        ...overrides,
      }),
    );

  const insertPlant = (overrides: Row = {}) =>
    insertRow(
      'plants_inventory.plant',
      withId({
        garden_id: gardenId,
        display_name: 'Tomato #1',
        created_by_profile_id: profileId,
        ...overrides,
      }),
    );

  const insertObservation = (overrides: Row = {}) =>
    insertRow(
      'observations_history.observation',
      withId({
        garden_id: gardenId,
        created_by_profile_id: profileId,
        note_text: 'Field note',
        ...overrides,
      }),
    );

  const insertTask = (overrides: Row = {}) =>
    insertRow(
      'tasks_recommendations.task',
      withId({
        garden_id: gardenId,
        target_kind: 'garden',
        title: 'Water the whole garden',
        created_by_profile_id: profileId,
        ...overrides,
      }),
    );

  const insertQuotaReservation = (overrides: Row) =>
    insertRow('media.quota_reservation', withId({ reserved_bytes: 500, ...overrides }));

  it('adds every new media_record column and creates media.quota_reservation', async () => {
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'media' AND table_name = 'media_record'`,
    );
    const columnNames = columns.rows.map((row) => row.column_name).sort();

    expect(columnNames).toEqual(
      [
        'id',
        'garden_id',
        'uploaded_by_profile_id',
        'media_class',
        'display_filename',
        'declared_content_type',
        'verified_content_type',
        'declared_byte_size',
        'verified_byte_size',
        'checksum_sha256',
        'bucket_name',
        'object_key',
        'upload_state',
        'processing_state',
        'capture_session_id',
        'sensitivity_classification',
        'retention_deadline_at',
        'derived_from_media_id',
        'transformation_version',
        'revision',
        'created_at',
        'updated_at',
      ].sort(),
    );

    const table = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'media' AND table_name = 'quota_reservation'`,
    );
    expect(table.rows).toHaveLength(1);
  });

  it('grants the application role row access to media.quota_reservation without schema authority', async () => {
    const result = await client.query<{ can_select: boolean; can_insert: boolean }>(
      `SELECT
         has_table_privilege('verdery_application', 'media.quota_reservation', 'SELECT') AS can_select,
         has_table_privilege('verdery_application', 'media.quota_reservation', 'INSERT') AS can_insert`,
    );
    expect(result.rows[0]?.can_select).toBe(true);
    expect(result.rows[0]?.can_insert).toBe(true);
  });

  it('registers a media record with the documented defaults', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();

    const row = await client.query<{
      upload_state: string;
      processing_state: string | null;
      revision: number;
      garden_id: string | null;
      bucket_name: string | null;
      object_key: string | null;
      checksum_sha256: string | null;
      verified_content_type: string | null;
      verified_byte_size: number | null;
      retention_deadline_at: Date | null;
      derived_from_media_id: string | null;
      transformation_version: number | null;
      declared_byte_size: number;
    }>(
      `SELECT upload_state, processing_state, revision, garden_id, bucket_name, object_key,
              checksum_sha256, verified_content_type, verified_byte_size, retention_deadline_at,
              derived_from_media_id, transformation_version, declared_byte_size
         FROM media.media_record WHERE id = $1`,
      [mediaId],
    );

    expect(row.rows[0]).toEqual({
      upload_state: 'registered',
      processing_state: null,
      revision: 1,
      garden_id: null,
      bucket_name: null,
      object_key: null,
      checksum_sha256: null,
      verified_content_type: null,
      verified_byte_size: null,
      retention_deadline_at: null,
      derived_from_media_id: null,
      transformation_version: null,
      declared_byte_size: 123_456,
    });
  });

  it('accepts a garden_id, and accepts a media record with none', async () => {
    await freshFoundation();

    const withGarden = await insertMediaRecord({ garden_id: gardenId });
    const withoutGarden = await insertMediaRecord();

    const rows = await client.query<{ id: string; garden_id: string | null }>(
      'SELECT id, garden_id FROM media.media_record WHERE id = ANY($1)',
      [[withGarden, withoutGarden]],
    );
    expect(rows.rows.find((row) => row.id === withGarden)?.garden_id).toBe(gardenId);
    expect(rows.rows.find((row) => row.id === withoutGarden)?.garden_id).toBeNull();
  });

  it('rejects every invalid enumerated or formatted field', async () => {
    await freshFoundation();

    await expect(insertMediaRecord({ media_class: 'selfie' })).rejects.toThrow(
      /media_record_media_class_check/,
    );
    await expect(insertMediaRecord({ upload_state: 'uploaded' })).rejects.toThrow(
      /media_record_upload_state_check/,
    );
    await expect(insertMediaRecord({ processing_state: 'queued' })).rejects.toThrow(
      /media_record_processing_state_check/,
    );
    await expect(insertMediaRecord({ sensitivity_classification: 'top_secret' })).rejects.toThrow(
      /media_record_sensitivity_classification_check/,
    );
    await expect(insertMediaRecord({ checksum_sha256: 'not-a-checksum' })).rejects.toThrow(
      /media_record_checksum_sha256_format_check/,
    );
    await expect(insertMediaRecord({ declared_byte_size: 0 })).rejects.toThrow(
      /media_record_declared_byte_size_positive_check/,
    );
    await expect(insertMediaRecord({ verified_byte_size: -1 })).rejects.toThrow(
      /media_record_verified_byte_size_positive_check/,
    );
    await expect(insertMediaRecord({ bucket_name: 'verdery-media' })).rejects.toThrow(
      /media_record_storage_target_pairing_check/,
    );
    await expect(insertMediaRecord({ transformation_version: 1 })).rejects.toThrow(
      /media_record_transformation_version_requires_derivative_check/,
    );
  });

  it('accepts a valid 64-character lowercase hex checksum', async () => {
    await freshFoundation();
    const checksum = 'a'.repeat(64);

    const mediaId = await insertMediaRecord({ checksum_sha256: checksum });

    const row = await client.query<{ checksum_sha256: string }>(
      'SELECT checksum_sha256 FROM media.media_record WHERE id = $1',
      [mediaId],
    );
    expect(row.rows[0]?.checksum_sha256).toBe(checksum);
  });

  it('records a derivative with its transformation version, pointing back at its original', async () => {
    await freshFoundation();
    const originalId = await insertMediaRecord();

    const derivativeId = await insertMediaRecord({
      media_class: 'derived_preview',
      derived_from_media_id: originalId,
      transformation_version: 2,
    });

    const row = await client.query<{
      derived_from_media_id: string;
      transformation_version: number;
    }>(
      'SELECT derived_from_media_id, transformation_version FROM media.media_record WHERE id = $1',
      [derivativeId],
    );
    expect(row.rows[0]).toEqual({ derived_from_media_id: originalId, transformation_version: 2 });
  });

  it('enforces at most one media row per bucket/object key pair, but allows any number of unset pairs', async () => {
    await freshFoundation();

    await insertMediaRecord({ bucket_name: 'verdery-media', object_key: 'shard/a/b' });
    await insertMediaRecord();
    await insertMediaRecord();

    await expect(
      insertMediaRecord({ bucket_name: 'verdery-media', object_key: 'shard/a/b' }),
    ).rejects.toThrow(/media_record_bucket_object_key_key/);
  });

  it('still attaches media to a plant photo, an observation photo, and a task attachment', async () => {
    await freshFoundation();
    const plantId = await insertPlant();
    const observationId = await insertObservation();
    const taskId = await insertTask();

    const plantPhotoMediaId = await insertMediaRecord();
    const observationPhotoMediaId = await insertMediaRecord();
    const taskAttachmentMediaId = await insertMediaRecord();

    await insertRow(
      'plants_inventory.plant_photo',
      withId({ plant_id: plantId, media_id: plantPhotoMediaId }),
    );
    await insertRow(
      'observations_history.observation_photo',
      withId({ observation_id: observationId, media_id: observationPhotoMediaId }),
    );
    await insertRow(
      'tasks_recommendations.task_attachment',
      withId({ task_id: taskId, media_id: taskAttachmentMediaId }),
    );

    const counts = await client.query<{ table_name: string; count: number }>(
      `SELECT 'plant_photo' AS table_name, count(*)::int AS count
         FROM plants_inventory.plant_photo WHERE media_id = $1
       UNION ALL
       SELECT 'observation_photo', count(*)::int FROM observations_history.observation_photo
         WHERE media_id = $2
       UNION ALL
       SELECT 'task_attachment', count(*)::int FROM tasks_recommendations.task_attachment
         WHERE media_id = $3`,
      [plantPhotoMediaId, observationPhotoMediaId, taskAttachmentMediaId],
    );
    for (const row of counts.rows) {
      expect(row.count, row.table_name).toBe(1);
    }

    await expect(
      insertRow(
        'plants_inventory.plant_photo',
        withId({ plant_id: plantId, media_id: randomUUID() }),
      ),
    ).rejects.toThrow(/plant_photo_media_id_fkey/);
  });

  it('reserves quota for a garden, and rejects a scope that names both or neither reference', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();

    const reservationId = await insertQuotaReservation({
      scope_kind: 'garden',
      scope_garden_id: gardenId,
      media_id: mediaId,
    });

    const row = await client.query<{ state: string; reserved_bytes: number }>(
      'SELECT state, reserved_bytes FROM media.quota_reservation WHERE id = $1',
      [reservationId],
    );
    expect(row.rows[0]).toEqual({ state: 'reserved', reserved_bytes: 500 });

    await expect(
      insertQuotaReservation({
        scope_kind: 'garden',
        scope_garden_id: gardenId,
        scope_profile_id: profileId,
        media_id: mediaId,
      }),
    ).rejects.toThrow(/quota_reservation_scope_consistency_check/);

    await expect(
      insertQuotaReservation({ scope_kind: 'garden', media_id: mediaId }),
    ).rejects.toThrow(/quota_reservation_scope_consistency_check/);
  });

  it('reserves quota for an account, and rejects a non-positive byte count or an unrecognized state', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();

    const reservationId = await insertQuotaReservation({
      scope_kind: 'account',
      scope_profile_id: profileId,
      media_id: mediaId,
    });
    const row = await client.query<{ scope_profile_id: string }>(
      'SELECT scope_profile_id FROM media.quota_reservation WHERE id = $1',
      [reservationId],
    );
    expect(row.rows[0]?.scope_profile_id).toBe(profileId);

    await expect(
      insertQuotaReservation({
        scope_kind: 'account',
        scope_profile_id: profileId,
        media_id: mediaId,
        reserved_bytes: 0,
      }),
    ).rejects.toThrow(/quota_reservation_reserved_bytes_positive_check/);

    await expect(
      insertQuotaReservation({
        scope_kind: 'account',
        scope_profile_id: profileId,
        media_id: mediaId,
        state: 'expired',
      }),
    ).rejects.toThrow(/quota_reservation_state_check/);
  });

  it('rejects a quota reservation for a media id that does not exist', async () => {
    await freshFoundation();

    await expect(
      insertQuotaReservation({
        scope_kind: 'account',
        scope_profile_id: profileId,
        media_id: randomUUID(),
      }),
    ).rejects.toThrow(/quota_reservation_media_id_fkey/);
  });

  it('rolls back, restoring the pre-migration media_record shape and leaving quota_reservation gone', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();
    await insertQuotaReservation({
      scope_kind: 'account',
      scope_profile_id: profileId,
      media_id: mediaId,
    });

    await client.end();

    // `count: 2` undoes 1785200000000_media-processing-jobs.sql (now the
    // newest migration) first, then this one — matching every earlier
    // migration test's own convention of unwinding whatever landed on top
    // since this file was written. Update again the next time a migration
    // is added on top of that one.
    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      count: 2,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const quotaReservationTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'media' AND table_name = 'quota_reservation'`,
    );
    expect(quotaReservationTable.rows).toHaveLength(0);

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'media' AND table_name = 'media_record'`,
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(
      ['id', 'storage_reference', 'mime_type', 'uploaded_by_profile_id', 'created_at'].sort(),
    );

    const survivingRow = await client.query<{ mime_type: string }>(
      'SELECT mime_type FROM media.media_record WHERE id = $1',
      [mediaId],
    );
    expect(survivingRow.rows[0]?.mime_type).toBe('image/jpeg');

    const survivingPlantTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'plants_inventory' AND table_name = 'plant'`,
    );
    expect(survivingPlantTable.rows).toHaveLength(1);
  });
});
