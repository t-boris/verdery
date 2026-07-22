/**
 * Migration tests against the supported PostgreSQL/PostGIS image.
 *
 * A fresh database is migrated up, the invariants the whole schema depends on
 * are asserted, and the migration is rolled back. SQLite or a plain PostgreSQL
 * image would not exercise PostGIS and is not a substitute.
 *
 * Source: architecture/testing-strategy.md, section "6. Backend Integration Tests";
 *         ADR-0009, "Toolchain and Platform Version Baseline".
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'platform baseline migration';

/** Pinned by ADR-0009. The image tag encodes both PostgreSQL 17 and PostGIS 3.5. */
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';

/**
 * The pinned image publishes a linux/amd64 manifest only.
 *
 * Requesting it explicitly makes the test behave the same everywhere: a no-op
 * on the amd64 CI runner, and emulation on an arm64 developer machine. Without
 * it, Docker on Apple silicon fails the pull with "no matching manifest", which
 * looked like a passing suite only because Docker happened to be stopped.
 */
const POSTGIS_PLATFORM = 'linux/amd64';

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations', import.meta.url));

const MODULE_SCHEMAS = [
  'identity_access',
  'collaboration',
  'gardens_mapping',
  'plants_inventory',
  'observations_history',
  'tasks_recommendations',
  'media',
  'capture_import',
  'platform',
] as const;

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
    log: () => {
      // The runner logs to the console by default, which would interleave with
      // test output without adding anything the assertions do not cover.
    },
  });
}

// These checks need no container, so a rollback path can never be forgotten
// even where the container-backed suite below is skipped.
describe('migration files', () => {
  it('declare both an up and a down section', async () => {
    const files = (await readdir(MIGRATIONS_DIRECTORY)).filter((name) => name.endsWith('.sql'));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const contents = await readFile(join(MIGRATIONS_DIRECTORY, file), 'utf8');

      // The loader recognizes the direction markers case-insensitively at the
      // start of a comment line.
      expect(contents, `${file} is missing an up section`).toMatch(/^\s*--[\s-]*up\s+migration/im);
      expect(contents, `${file} is missing a down section`).toMatch(
        /^\s*--[\s-]*down\s+migration/im,
      );
    }
  });
});

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

  it('installs PostGIS at the pinned version', async () => {
    const result = await client.query<{ version: string }>(
      "SELECT extversion AS version FROM pg_extension WHERE extname = 'postgis'",
    );

    expect(result.rows[0]?.version).toMatch(/^3\.5(\.|$)/);
  });

  it('stores and measures geometry in the local planar space', async () => {
    // Accepted editable geometry lives in SRID 0 — an undefined Cartesian system
    // whose units are metres — so distance is a plain planar length.
    // Source: ADR-0010, "Coordinate space registration".
    const result = await client.query<{ srid: number; distance: number }>(
      `SELECT ST_SRID(a) AS srid, ST_Distance(a, b) AS distance
         FROM (SELECT ST_GeomFromText('POINT(0 0)', 0) AS a,
                      ST_GeomFromText('POINT(3 4)', 0) AS b) AS points`,
    );

    expect(result.rows[0]?.srid).toBe(0);
    expect(Number(result.rows[0]?.distance)).toBeCloseTo(5, 9);
  });

  it('creates a schema for every owning module', async () => {
    const result = await client.query<{ nspname: string }>(
      'SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)',
      [[...MODULE_SCHEMAS]],
    );

    expect(result.rows.map((row) => row.nspname).sort()).toEqual([...MODULE_SCHEMAS].sort());
  });

  it('gives the application role read and write access but no schema authority', async () => {
    const result = await client.query<{ can_use: boolean; can_create: boolean }>(
      `SELECT has_schema_privilege('verdery_application', 'gardens_mapping', 'USAGE') AS can_use,
              has_schema_privilege('verdery_application', 'gardens_mapping', 'CREATE') AS can_create`,
    );

    expect(result.rows[0]?.can_use).toBe(true);
    expect(result.rows[0]?.can_create).toBe(false);
  });

  it('grants the application role row access to tables the migration role creates', async () => {
    await client.query('SET ROLE verdery_migration');
    await client.query('CREATE TABLE gardens_mapping.privilege_probe (id integer PRIMARY KEY)');
    await client.query('RESET ROLE');

    const result = await client.query<{ can_select: boolean; can_alter: boolean }>(
      `SELECT has_table_privilege('verdery_application', 'gardens_mapping.privilege_probe', 'SELECT') AS can_select,
              pg_has_role('verdery_application', 'verdery_migration', 'MEMBER') AS can_alter`,
    );

    expect(result.rows[0]?.can_select).toBe(true);
    expect(result.rows[0]?.can_alter).toBe(false);

    await client.query('DROP TABLE gardens_mapping.privilege_probe');
  });

  it('rolls back to an empty database', async () => {
    await client.end();
    await migrate(databaseUrl, 'down');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const schemas = await client.query<{ nspname: string }>(
      'SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)',
      [[...MODULE_SCHEMAS]],
    );
    const roles = await client.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('verdery_migration', 'verdery_application')",
    );

    expect(schemas.rows).toHaveLength(0);
    expect(roles.rows).toHaveLength(0);
  });
});
