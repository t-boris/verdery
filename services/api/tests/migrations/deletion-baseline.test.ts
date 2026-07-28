/**
 * Migration tests for 1786400000000_deletion-baseline.sql (P8-DELETE-01):
 * the deletion-record state machine and its one-purge-per-subject index, the
 * checkpoint table, the garden and profile recovery-window columns with their
 * linkage CHECKs, the addressed-sync-change column, the dropped membership
 * foreign key that lets a revocation tombstone outlive its garden, the
 * privilege posture, and the down migration's ripple.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'deletion baseline migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

async function migrate(
  databaseUrl: string,
  direction: 'up' | 'down',
  count = Number.POSITIVE_INFINITY,
): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIRECTORY,
    direction,
    migrationsTable: 'pgmigrations',
    count,
    log: () => {},
  });
}

type Row = Record<string, unknown>;

const DEADLINE = new Date('2026-08-24T09:00:00Z');
const REQUESTED_AT = new Date('2026-07-25T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    profileId = randomUUID();
    await client.query(
      `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
       VALUES ($1, $2, 'active')`,
      [profileId, `firebase-${profileId}`],
    );
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertGarden(overrides: Row = {}): Promise<string> {
    const row: Row = {
      id: randomUUID(),
      name: 'Deletion Garden',
      created_by_profile_id: profileId,
      ...overrides,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO gardens_mapping.garden (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return row['id'] as string;
  }

  async function insertDeletionRecord(overrides: Row = {}): Promise<string> {
    const row: Row = {
      id: randomUUID(),
      subject_type: 'garden',
      subject_id: randomUUID(),
      requested_by_profile_id: profileId,
      requested_at: REQUESTED_AT,
      recovery_deadline_at: DEADLINE,
      purge_started_at: DEADLINE,
      ...overrides,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO deletion.deletion_record (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return row['id'] as string;
  }

  it('creates a deletion record with the documented defaults: purging, attempt 0, nothing deferred or completed', async () => {
    const id = await insertDeletionRecord();

    const { rows } = await client.query<Row>(
      'SELECT * FROM deletion.deletion_record WHERE id = $1',
      [id],
    );
    expect(rows[0]).toMatchObject({
      state: 'purging',
      attempt_count: 0,
      deferred_reason: null,
      media_records_scheduled: 0,
      identity_provider_deleted_at: null,
      completed_at: null,
      revision: 1,
    });

    await client.query('DELETE FROM deletion.deletion_record WHERE id = $1', [id]);
  });

  it('enforces the subject vocabulary, the two-value state machine, and "purged implies a completion instant"', async () => {
    await expect(insertDeletionRecord({ subject_type: 'planet' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertDeletionRecord({ state: 'failed' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertDeletionRecord({ state: 'purged' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertDeletionRecord({ media_records_scheduled: -1 })).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('allows exactly one purge per subject, forever — the sweep claim is decided by the database, not a check', async () => {
    const subjectId = randomUUID();
    const first = await insertDeletionRecord({ subject_id: subjectId });

    await expect(insertDeletionRecord({ subject_id: subjectId })).rejects.toMatchObject({
      code: '23505',
      constraint: 'deletion_record_subject_key',
    });

    // A completed purge still blocks a second one: the row is the permanent
    // certificate that this subject was purged.
    await client.query(
      `UPDATE deletion.deletion_record SET state = 'purged', completed_at = now() WHERE id = $1`,
      [first],
    );
    await expect(insertDeletionRecord({ subject_id: subjectId })).rejects.toMatchObject({
      code: '23505',
    });

    // The same id under the OTHER subject type is a different subject.
    const account = await insertDeletionRecord({ subject_id: subjectId, subject_type: 'account' });

    await client.query('DELETE FROM deletion.deletion_record WHERE id IN ($1, $2)', [
      first,
      account,
    ]);
  });

  it('stores one checkpoint per step, cascading with its deletion record', async () => {
    const id = await insertDeletionRecord();
    const insertCheckpoint = (overrides: Row = {}): Promise<unknown> =>
      client.query(
        `INSERT INTO deletion.purge_checkpoint (deletion_id, step_name, rows_deleted, completed_at)
         VALUES ($1, $2, $3, $4)`,
        [
          id,
          overrides['step_name'] ?? 'plants_inventory.plant',
          overrides['rows_deleted'] ?? 12,
          DEADLINE,
        ],
      );

    await insertCheckpoint();
    await expect(insertCheckpoint()).rejects.toMatchObject({ code: '23505' });
    await expect(insertCheckpoint({ step_name: '' })).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertCheckpoint({ step_name: 'media.media_record', rows_deleted: -1 }),
    ).rejects.toMatchObject({ code: '23514' });

    await client.query('DELETE FROM deletion.deletion_record WHERE id = $1', [id]);
    const { rows } = await client.query<Row>(
      'SELECT count(*)::int AS count FROM deletion.purge_checkpoint WHERE deletion_id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ count: 0 });
  });

  it('pairs a garden recovery deadline with exactly the deleting lifecycle states, and accepts the new purging state', async () => {
    // An active garden may not carry a deadline.
    await expect(insertGarden({ recovery_deadline_at: DEADLINE })).rejects.toMatchObject({
      code: '23514',
    });
    // A deleting garden must.
    await expect(insertGarden({ lifecycle_state: 'deletion_requested' })).rejects.toMatchObject({
      code: '23514',
    });

    const deleting = await insertGarden({
      lifecycle_state: 'deletion_requested',
      deletion_requested_at: REQUESTED_AT,
      recovery_deadline_at: DEADLINE,
    });
    await client.query(
      `UPDATE gardens_mapping.garden SET lifecycle_state = 'purging' WHERE id = $1`,
      [deleting],
    );

    await client.query('DELETE FROM gardens_mapping.garden WHERE id = $1', [deleting]);
  });

  it('pairs a profile recovery deadline with the deleting account states, and a purged instant with the purged state', async () => {
    const id = randomUUID();
    const insertProfile = (overrides: Row = {}): Promise<unknown> => {
      const row: Row = {
        id: randomUUID(),
        firebase_uid: `firebase-${randomUUID()}`,
        account_state: 'active',
        ...overrides,
      };
      const columns = Object.keys(row);
      const values = Object.values(row);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      return client.query(
        `INSERT INTO identity_access.profile (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    };

    await expect(insertProfile({ recovery_deadline_at: DEADLINE })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertProfile({ account_state: 'deletion_requested' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertProfile({ account_state: 'purged', purged_at: null })).rejects.toMatchObject(
      { code: '23514' },
    );

    await insertProfile({
      id,
      account_state: 'deletion_requested',
      deletion_requested_at: REQUESTED_AT,
      recovery_deadline_at: DEADLINE,
    });
    await client.query(
      `UPDATE identity_access.profile
          SET account_state = 'purged', purged_at = now(),
              recovery_deadline_at = NULL, deletion_requested_at = NULL
        WHERE id = $1`,
      [id],
    );

    await client.query('DELETE FROM identity_access.profile WHERE id = $1', [id]);
  });

  it('lets a revocation tombstone outlive its garden: the membership foreign key is gone, so the purge can delete the garden row', async () => {
    const gardenId = await insertGarden();
    const membershipId = randomUUID();
    await client.query(
      `INSERT INTO collaboration.membership (id, garden_id, profile_id, role, state)
       VALUES ($1, $2, $3, 'owner', 'removed')`,
      [membershipId, gardenId, profileId],
    );

    // This is the whole point: it would have failed with the foreign key.
    await client.query('DELETE FROM gardens_mapping.garden WHERE id = $1', [gardenId]);

    const { rows } = await client.query<Row>(
      'SELECT garden_id, state FROM collaboration.membership WHERE id = $1',
      [membershipId],
    );
    expect(rows[0]).toEqual({ garden_id: gardenId, state: 'removed' });

    await client.query('DELETE FROM collaboration.membership WHERE id = $1', [membershipId]);
  });

  it('adds an optional sync-change addressee that defaults to "everyone the visibility rule admits"', async () => {
    const gardenId = await insertGarden();
    await client.query(
      `INSERT INTO platform.sync_change (garden_id, record_id, record_type, operation, record_revision)
       VALUES ($1, $1, 'garden', 'upsert', 1)`,
      [gardenId],
    );
    await client.query(
      `INSERT INTO platform.sync_change
         (garden_id, record_id, record_type, operation, record_revision, target_profile_id)
       VALUES ($1, $1, 'garden', 'delete', 2, $2)`,
      [gardenId, profileId],
    );

    const { rows } = await client.query<Row>(
      `SELECT operation, target_profile_id FROM platform.sync_change
        WHERE garden_id = $1 ORDER BY sequence`,
      [gardenId],
    );
    expect(rows).toEqual([
      { operation: 'upsert', target_profile_id: null },
      { operation: 'delete', target_profile_id: profileId },
    ]);

    await client.query('DELETE FROM platform.sync_change WHERE garden_id = $1', [gardenId]);
    await client.query('DELETE FROM gardens_mapping.garden WHERE id = $1', [gardenId]);
  });

  it('grants verdery_application row access via the schema default privileges, and verdery_worker nothing', async () => {
    const { rows } = await client.query<Row>(
      `SELECT grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'deletion' AND table_name = 'deletion_record'`,
    );

    const grantees = new Set(rows.map((row) => row['grantee']));
    expect(grantees.has('verdery_application')).toBe(true);
    expect(grantees.has('verdery_worker')).toBe(false);
    expect(grantees.has('PUBLIC')).toBe(false);
  });

  it('rolls back cleanly: the deletion schema drops whole, the membership foreign key and the narrow lifecycle CHECK return, and re-migrating up succeeds', async () => {
    // `count: 12` undoes this migration and every migration applied after it
    // (currently through 1787500000000_plant-identification-acquisition-date.sql).
    // Update this count when a later migration is added on top.
    await migrate(databaseUrl, 'down', 12);

    const schema = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'deletion'`,
    );
    expect(schema.rowCount).toBe(0);

    const foreignKey = await client.query(
      `SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'collaboration' AND table_name = 'membership'
          AND constraint_name = 'membership_garden_id_fkey'`,
    );
    expect(foreignKey.rowCount).toBe(1);

    const columns = await client.query<Row>(
      `SELECT column_name FROM information_schema.columns
        WHERE (table_schema, table_name) IN (
                ('gardens_mapping', 'garden'), ('identity_access', 'profile'), ('platform', 'sync_change')
              )
          AND column_name IN ('recovery_deadline_at', 'purged_at', 'target_profile_id')`,
    );
    expect(columns.rowCount).toBe(0);

    await migrate(databaseUrl, 'up');
    const restored = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'deletion'`,
    );
    expect(restored.rowCount).toBe(1);
  });
});
