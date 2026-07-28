/**
 * Migration tests for 1786300000000_exports-baseline.sql (P8-EXPORT-01):
 * the export-request table's state machine constraints, the scope/garden
 * pairing, the one-active-per-requester partial unique index, the
 * checkpoint table's shape, the notification-intent garden nullability
 * widening with its care-recommendation linkage CHECK, the privilege
 * posture, and the down migration's clean ripple.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'exports baseline migration';
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

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;
  let gardenId: string;

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
    gardenId = randomUUID();
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id)
       VALUES ($1, 'Export Garden', $2)`,
      [gardenId, profileId],
    );
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  function requestRow(overrides: Row = {}): Row {
    return {
      id: randomUUID(),
      requester_profile_id: profileId,
      scope: 'account',
      garden_id: null,
      include_media: true,
      format_version: '1',
      session_credential_kind: 'sessionCookie',
      session_authenticated_at: new Date('2026-07-25T09:00:00Z'),
      output_media_id: randomUUID(),
      package_bucket_name: 'test-exports',
      package_object_key: `ab/${randomUUID()}/${randomUUID()}`,
      ...overrides,
    };
  }

  async function insertRequest(overrides: Row = {}): Promise<string> {
    const row = requestRow(overrides);
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO exports.export_request (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return row['id'] as string;
  }

  it('creates a request with the documented defaults: requested, attempt 0, revision 1, no boundary or expiry', async () => {
    const id = await insertRequest();

    const { rows } = await client.query<Row>('SELECT * FROM exports.export_request WHERE id = $1', [
      id,
    ]);
    expect(rows[0]).toMatchObject({
      state: 'requested',
      attempt_count: 0,
      revision: 1,
      boundary_at: null,
      expires_at: null,
      completed_at: null,
      output_checksum_sha256: null,
      failure_code: null,
    });

    await client.query('DELETE FROM exports.export_request WHERE id = $1', [id]);
  });

  it('enforces the scope vocabulary, the scope/garden pairing, and the completed/failed field implications', async () => {
    await expect(insertRequest({ scope: 'universe' })).rejects.toMatchObject({ code: '23514' });
    await expect(insertRequest({ scope: 'garden', garden_id: null })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertRequest({ scope: 'account', garden_id: gardenId })).rejects.toMatchObject({
      code: '23514',
    });
    // Completed without its package facts is unrepresentable.
    await expect(insertRequest({ state: 'completed' })).rejects.toMatchObject({ code: '23514' });
    // Failed without a reason is unrepresentable.
    await expect(insertRequest({ state: 'failed' })).rejects.toMatchObject({ code: '23514' });
  });

  it('allows ONE active export per requester across requested and running, while terminal rows never block a new one', async () => {
    const first = await insertRequest();
    await expect(insertRequest()).rejects.toMatchObject({
      code: '23505',
      constraint: 'export_request_one_active_per_requester',
    });

    await client.query(`UPDATE exports.export_request SET state = 'running' WHERE id = $1`, [
      first,
    ]);
    await expect(insertRequest()).rejects.toMatchObject({ code: '23505' });

    await client.query(
      `UPDATE exports.export_request SET state = 'failed', failure_code = 'test' WHERE id = $1`,
      [first],
    );
    const second = await insertRequest();

    await client.query('DELETE FROM exports.export_request WHERE id IN ($1, $2)', [first, second]);
  });

  it('stores checkpoints keyed by entry path, with disposition and checksum constraints, cascading with their request', async () => {
    const id = await insertRequest();
    const checkpoint = (overrides: Row = {}): Row => ({
      export_request_id: id,
      entry_path: 'export.json',
      disposition: 'package',
      bucket_name: 'test-exports',
      object_key: `staging/${id}/export.json`,
      content_type: 'application/json',
      checksum_sha256: 'a'.repeat(64),
      byte_size: 42,
      completed_at: new Date('2026-07-25T09:01:00Z'),
      ...overrides,
    });
    const insertCheckpoint = async (overrides: Row = {}): Promise<void> => {
      const row = checkpoint(overrides);
      const columns = Object.keys(row);
      const values = Object.values(row);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      await client.query(
        `INSERT INTO exports.export_section_checkpoint (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    };

    await insertCheckpoint();
    // Same entry path twice is one checkpoint, structurally.
    await expect(insertCheckpoint()).rejects.toMatchObject({ code: '23505' });
    await expect(
      insertCheckpoint({ entry_path: 'x.json', disposition: 'secret' }),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertCheckpoint({ entry_path: 'y.json', checksum_sha256: 'nope' }),
    ).rejects.toMatchObject({ code: '23514' });

    await client.query('DELETE FROM exports.export_request WHERE id = $1', [id]);
    const { rows } = await client.query(
      'SELECT count(*)::int AS count FROM exports.export_section_checkpoint WHERE export_request_id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ count: 0 });
  });

  it('widens notification_intent.garden_id to nullable for export_ready while care_recommendation still requires a garden', async () => {
    const insertIntent = async (overrides: Row): Promise<void> => {
      const candidateId = randomUUID();
      const row: Row = {
        id: randomUUID(),
        intent_type: 'export_ready',
        recipient_profile_id: profileId,
        garden_id: null,
        recommendation_candidate_id: null,
        source_event_id: randomUUID(),
        template_key: 'export_ready.completed.v1',
        template_parameters: JSON.stringify({}),
        priority: 'normal',
        channel_in_app: true,
        channel_push: false,
        deep_link: JSON.stringify({ kind: 'exportReady', exportRequestId: randomUUID() }),
        dedup_key: `export_ready:request:${candidateId}`,
        earliest_delivery_at: new Date('2026-07-25T09:00:00Z'),
        expires_at: new Date('2026-08-01T09:00:00Z'),
        ...overrides,
      };
      const columns = Object.keys(row);
      const values = Object.values(row);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      await client.query(
        `INSERT INTO notifications.notification_intent (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
    };

    await insertIntent({});
    await expect(
      insertIntent({
        intent_type: 'care_recommendation',
        garden_id: null,
        recommendation_candidate_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('grants verdery_application row access via the schema default privileges, and verdery_worker nothing', async () => {
    const { rows } = await client.query<Row>(
      `SELECT grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'exports' AND table_name = 'export_request'`,
    );

    const grantees = new Set(rows.map((row) => row['grantee']));
    expect(grantees.has('verdery_application')).toBe(true);
    expect(grantees.has('verdery_worker')).toBe(false);
    expect(grantees.has('PUBLIC')).toBe(false);
  });

  it('rolls back cleanly: the exports schema drops whole, garden_id NOT NULL returns, and re-migrating up succeeds', async () => {
    // `count: 13` undoes this migration and every migration applied after it
    // (currently through 1787500000000_plant-identification-acquisition-date.sql).
    // Update this count when a later migration is added on top.
    await migrate(databaseUrl, 'down', 13);

    const schema = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'exports'`,
    );
    expect(schema.rowCount).toBe(0);

    const nullability = await client.query<Row>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'notifications' AND table_name = 'notification_intent'
          AND column_name = 'garden_id'`,
    );
    expect(nullability.rows[0]).toEqual({ is_nullable: 'NO' });

    await migrate(databaseUrl, 'up');
    const restored = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'exports'`,
    );
    expect(restored.rowCount).toBe(1);
  });
});
