/**
 * Migration test for the synchronization-baseline migration:
 * `platform.sync_client_installation`'s shape, its `platform` check
 * constraint, and that rolling it back leaves every earlier migration's
 * tables intact.
 *
 * Source: migrations/1785000000000_synchronization-baseline.sql;
 *         architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'synchronization baseline migration';
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

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    profileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
  });

  it('inserts and upserts a client installation row', async () => {
    const installationId = randomUUID();

    await client.query(
      `INSERT INTO platform.sync_client_installation
         (id, profile_id, platform, app_version, protocol_version)
       VALUES ($1, $2, 'ios', '1.0.0', 1)`,
      [installationId, profileId],
    );

    const inserted = await client.query<{
      platform: string;
      app_version: string;
      protocol_version: number;
      revoked_at: Date | null;
    }>(
      `SELECT platform, app_version, protocol_version, revoked_at
         FROM platform.sync_client_installation WHERE id = $1`,
      [installationId],
    );
    expect(inserted.rows).toEqual([
      { platform: 'ios', app_version: '1.0.0', protocol_version: 1, revoked_at: null },
    ]);

    // Register-or-refresh: the same id may be re-registered under a
    // different profile (a device changing accounts) — see the migration's
    // own comment on `profile_id`.
    const secondProfileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      secondProfileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO platform.sync_client_installation
         (id, profile_id, platform, app_version, protocol_version)
       VALUES ($1, $2, 'web', '2.0.0', 2)
       ON CONFLICT (id) DO UPDATE SET
         profile_id = EXCLUDED.profile_id,
         platform = EXCLUDED.platform,
         app_version = EXCLUDED.app_version,
         protocol_version = EXCLUDED.protocol_version`,
      [installationId, secondProfileId],
    );

    const refreshed = await client.query<{ profile_id: string; platform: string }>(
      `SELECT profile_id, platform FROM platform.sync_client_installation WHERE id = $1`,
      [installationId],
    );
    expect(refreshed.rows).toEqual([{ profile_id: secondProfileId, platform: 'web' }]);
  });

  it('rejects a platform value outside ios/web', async () => {
    await expect(
      client.query(
        `INSERT INTO platform.sync_client_installation
           (id, profile_id, platform, app_version, protocol_version)
         VALUES ($1, $2, 'android', '1.0.0', 1)`,
        [randomUUID(), profileId],
      ),
    ).rejects.toThrow(/sync_client_installation_platform_check/);
  });

  it('rejects a profile_id with no matching profile row', async () => {
    await expect(
      client.query(
        `INSERT INTO platform.sync_client_installation
           (id, profile_id, platform, app_version, protocol_version)
         VALUES ($1, $2, 'ios', '1.0.0', 1)`,
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it('rolls back, leaving the search-indexes schemas and tables otherwise intact', async () => {
    await client.end();

    // `count: 2` undoes this migration and every migration applied after it
    // (currently media-lifecycle-and-quotas, which does not depend on
    // `platform.sync_client_installation` but was applied later and must
    // unwind first). Update this count when a later migration is added on
    // top.
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

    const droppedTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'platform' AND table_name = 'sync_client_installation'`,
    );
    expect(droppedTable.rows).toHaveLength(0);

    const survivingIdempotencyTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'platform' AND table_name = 'idempotency_record'`,
    );
    expect(survivingIdempotencyTable.rows).toHaveLength(1);
  });
});
