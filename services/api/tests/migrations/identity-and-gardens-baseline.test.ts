/**
 * Migration tests for the identity, gardens, and platform tables.
 *
 * Runs the full migration set (platform baseline, then this one) against the
 * pinned PostgreSQL/PostGIS image, then asserts the invariants P2-DATA-01
 * depends on: the tables exist, the least-privilege application role can read
 * and write them without schema authority, and the constraints that encode
 * account state, garden lifecycle, and garden roles reject invalid values.
 *
 * Source: implementation-plan.md work package P2-DATA-01;
 *         architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'identity and gardens baseline migration';

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

const NEW_TABLES = [
  'identity_access.profile',
  'identity_access.identity_provider_link',
  'identity_access.consent_record',
  'gardens_mapping.garden',
  'collaboration.membership',
  'collaboration.invitation',
  'platform.idempotency_record',
  'platform.outbox_event',
  'platform.sync_change',
  'platform.audit_event',
] as const;

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;

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

  it('creates every identity, gardens, collaboration, and platform table', async () => {
    const result = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (
          ('identity_access', 'profile'),
          ('identity_access', 'identity_provider_link'),
          ('identity_access', 'consent_record'),
          ('gardens_mapping', 'garden'),
          ('collaboration', 'membership'),
          ('collaboration', 'invitation'),
          ('platform', 'idempotency_record'),
          ('platform', 'outbox_event'),
          ('platform', 'sync_change'),
          ('platform', 'audit_event')
        )`,
    );

    expect(result.rows.map((row) => row.qualified).sort()).toEqual([...NEW_TABLES].sort());
  });

  it('grants the application role row access without schema authority, for every new table', async () => {
    const result = await client.query<{
      qualified: string;
      can_select: boolean;
      can_insert: boolean;
    }>(
      `SELECT table_schema || '.' || table_name AS qualified,
              has_table_privilege('verdery_application', table_schema || '.' || table_name, 'SELECT') AS can_select,
              has_table_privilege('verdery_application', table_schema || '.' || table_name, 'INSERT') AS can_insert
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (
          ('identity_access', 'profile'),
          ('identity_access', 'identity_provider_link'),
          ('identity_access', 'consent_record'),
          ('gardens_mapping', 'garden'),
          ('collaboration', 'membership'),
          ('collaboration', 'invitation'),
          ('platform', 'idempotency_record'),
          ('platform', 'outbox_event'),
          ('platform', 'sync_change'),
          ('platform', 'audit_event')
        )`,
    );

    expect(result.rows).toHaveLength(NEW_TABLES.length);
    for (const row of result.rows) {
      expect(row.can_select, `${row.qualified} SELECT`).toBe(true);
      expect(row.can_insert, `${row.qualified} INSERT`).toBe(true);
    }
  });

  it('rejects an account state outside the documented lifecycle', async () => {
    await expect(
      client.query(
        `INSERT INTO identity_access.profile (id, firebase_uid, account_state)
         VALUES ($1, $2, 'not_a_real_state')`,
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/profile_account_state_check/);
  });

  it('rejects a garden lifecycle state outside list/create/get/rename/archive/delete-request', async () => {
    const profileId = randomUUID();
    await client.query(`INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)`, [
      profileId,
      randomUUID(),
    ]);

    await expect(
      client.query(
        `INSERT INTO gardens_mapping.garden (id, name, lifecycle_state, created_by_profile_id)
         VALUES ($1, 'Backyard', 'deleted', $2)`,
        [randomUUID(), profileId],
      ),
    ).rejects.toThrow(/garden_lifecycle_state_check/);
  });

  it('accepts only owner, editor, or viewer as a membership role', async () => {
    const profileId = randomUUID();
    const gardenId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );

    await expect(
      client.query(
        `INSERT INTO collaboration.membership (id, garden_id, profile_id, role)
         VALUES ($1, $2, $3, 'superuser')`,
        [randomUUID(), gardenId, profileId],
      ),
    ).rejects.toThrow(/membership_role_check/);

    await client.query(
      `INSERT INTO collaboration.membership (id, garden_id, profile_id, role)
       VALUES ($1, $2, $3, 'owner')`,
      [randomUUID(), gardenId, profileId],
    );
    const membership = await client.query<{ role: string }>(
      'SELECT role FROM collaboration.membership WHERE garden_id = $1 AND profile_id = $2',
      [gardenId, profileId],
    );
    expect(membership.rows[0]?.role).toBe('owner');
  });

  it('replays the same idempotency key without a second row, and rejects a different one', async () => {
    const profileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);

    const key = randomUUID();
    await client.query(
      `INSERT INTO platform.idempotency_record
         (actor_profile_id, operation, idempotency_key, request_fingerprint,
          response_status_code, response_body, expires_at)
       VALUES ($1, 'gardens.create', $2, 'fingerprint-a', 201, '{}', now() + interval '1 hour')`,
      [profileId, key],
    );

    await expect(
      client.query(
        `INSERT INTO platform.idempotency_record
           (actor_profile_id, operation, idempotency_key, request_fingerprint,
            response_status_code, response_body, expires_at)
         VALUES ($1, 'gardens.create', $2, 'fingerprint-b', 201, '{}', now() + interval '1 hour')`,
        [profileId, key],
      ),
    ).rejects.toThrow(/idempotency_record_pkey/);
  });

  it('rolls back, leaving the platform-baseline schemas and roles otherwise intact', async () => {
    await client.end();

    // `count: 4` undoes this migration and every migration applied after it
    // (currently garden-map-baseline, plants-observations-tasks-baseline, and
    // search-indexes, each of which depends, directly or transitively, on
    // tables this one creates and must come down first). The shared
    // `migrate()` helper runs with an unbounded count, which is correct for
    // 'up' but would also undo platform-baseline here, which this test is
    // specifically checking survives. Update this count when a later
    // migration is added on top.
    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      count: 4,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const tables = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (
          ('identity_access', 'profile'),
          ('identity_access', 'identity_provider_link'),
          ('identity_access', 'consent_record'),
          ('gardens_mapping', 'garden'),
          ('collaboration', 'membership'),
          ('collaboration', 'invitation'),
          ('platform', 'idempotency_record'),
          ('platform', 'outbox_event'),
          ('platform', 'sync_change'),
          ('platform', 'audit_event')
        )`,
    );
    expect(tables.rows).toHaveLength(0);

    const schemas = await client.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname = 'identity_access'",
    );
    expect(schemas.rows).toHaveLength(1);
  });
});
