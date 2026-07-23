/**
 * Migration tests for the search-indexes migration: `pg_trgm`, its four GIN
 * trigram indexes, and functional proof that trigram matching finds what a
 * plain `ILIKE '%query%'` substring match (the algorithm it replaces for
 * `SearchTaxonomyReferences`, and the only algorithm `SearchPlants`/
 * `ListGardens`'s `nameQuery` ever had) would miss.
 *
 * Source: implementation-plan.md work package P4-SEARCH-01;
 *         architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'search indexes migration';

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

const TRGM_INDEXES = [
  { schema: 'plants_inventory', table: 'plant', index: 'plant_display_name_trgm_idx' },
  {
    schema: 'plants_inventory',
    table: 'taxonomy_reference',
    index: 'taxonomy_reference_scientific_name_trgm_idx',
  },
  {
    schema: 'plants_inventory',
    table: 'taxonomy_reference',
    index: 'taxonomy_reference_common_name_trgm_idx',
  },
  { schema: 'gardens_mapping', table: 'garden', index: 'garden_name_trgm_idx' },
] as const;

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

  // Fresh profile and garden before every test that needs one, mirroring
  // plants-observations-tasks-baseline.test.ts's own freshFoundation() helper.
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

  it('installs the pg_trgm extension', async () => {
    const result = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
    );

    expect(result.rows).toHaveLength(1);
  });

  it('creates every GIN trigram index using gin_trgm_ops', async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname = ANY($1)`,
      [TRGM_INDEXES.map((i) => i.index)],
    );

    expect(result.rows).toHaveLength(TRGM_INDEXES.length);
    for (const row of result.rows) {
      expect(row.indexdef, row.indexname).toMatch(/USING gin/i);
      expect(row.indexdef, row.indexname).toMatch(/gin_trgm_ops/);
    }
  });

  it('grants the application role usage of the trigram functions with no extra grant', async () => {
    // pg_trgm's functions install into `public`, already on every role's
    // default search_path — see this migration's own header comment. If this
    // ever required an explicit GRANT, this query itself (executed as the
    // Testcontainers superuser, which does not prove verdery_application's
    // own access) would still pass, so this instead re-runs it under a
    // freshly created member-of-nothing-else probe role restricted to
    // exactly verdery_application's own grants.
    await client.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trgm_probe') " +
        "THEN CREATE ROLE trgm_probe LOGIN PASSWORD 'probe-password'; END IF; END $$;",
    );
    await client.query('GRANT verdery_application TO trgm_probe');

    const probeUrl = new URL(databaseUrl);
    probeUrl.username = 'trgm_probe';
    probeUrl.password = 'probe-password';

    const probeClient = new pg.Client({ connectionString: probeUrl.toString() });
    await probeClient.connect();
    const probeResult = await probeClient.query<{ score: number }>(
      "SELECT similarity('tomato', 'tomatoe') AS score",
    );
    expect(typeof probeResult.rows[0]?.score).toBe('number');
    await probeClient.end();

    await client.query('DROP ROLE trgm_probe');
  });

  it('finds a misspelled taxonomy common name that a plain ILIKE substring match would miss', async () => {
    await freshFoundation();
    const taxonomyId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.taxonomy_reference (id, scientific_name, common_name, source)
       VALUES ($1, 'Solanum lycopersicum', 'Tomato', 'system_catalog')`,
      [taxonomyId],
    );

    // The old algorithm this migration's own header comment says
    // `SearchTaxonomyReferences` used before P4-SEARCH-01: a plain
    // substring test. 'tomatoe' is not a substring of 'Tomato' in either
    // direction, so this finds nothing — the exact gap trigram search closes.
    const substringMatch = await client.query(
      `SELECT id FROM plants_inventory.taxonomy_reference WHERE common_name ILIKE $1`,
      ['%tomatoe%'],
    );
    expect(substringMatch.rows).toHaveLength(0);

    // Trigram similarity tolerates the misspelling.
    const trigramMatch = await client.query<{ id: string; score: number }>(
      `SELECT id, similarity(common_name, $1) AS score
         FROM plants_inventory.taxonomy_reference
        WHERE similarity(common_name, $1) > 0.25`,
      ['tomatoe'],
    );
    expect(trigramMatch.rows.map((r) => r.id)).toEqual([taxonomyId]);
    expect(trigramMatch.rows[0]?.score).toBeGreaterThan(0.25);
  });

  it('finds a misspelled plant display name that a plain ILIKE substring match would miss', async () => {
    await freshFoundation();
    const plantId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.plant (id, garden_id, display_name, created_by_profile_id)
       VALUES ($1, $2, 'Roma Tomato', $3)`,
      [plantId, gardenId, profileId],
    );

    const substringMatch = await client.query(
      `SELECT id FROM plants_inventory.plant WHERE display_name ILIKE $1`,
      ['%tomatoe%'],
    );
    expect(substringMatch.rows).toHaveLength(0);

    const trigramMatch = await client.query<{ id: string }>(
      `SELECT id FROM plants_inventory.plant WHERE similarity(display_name, $1) > 0.25`,
      ['tomatoe'],
    );
    expect(trigramMatch.rows.map((r) => r.id)).toEqual([plantId]);
  });

  it('finds a misspelled garden name that a plain ILIKE substring match would miss', async () => {
    profileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    const namedGardenId = randomUUID();
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Sunnyside Allotment', $2)`,
      [namedGardenId, profileId],
    );

    const substringMatch = await client.query(
      `SELECT id FROM gardens_mapping.garden WHERE name ILIKE $1`,
      ['%sunyside%'],
    );
    expect(substringMatch.rows).toHaveLength(0);

    const trigramMatch = await client.query<{ id: string }>(
      `SELECT id FROM gardens_mapping.garden WHERE similarity(name, $1) > 0.25 AND id = $2`,
      ['sunyside allotment', namedGardenId],
    );
    expect(trigramMatch.rows.map((r) => r.id)).toEqual([namedGardenId]);
  });

  it('rolls back, leaving the plants-observations-tasks-baseline schemas and tables otherwise intact', async () => {
    await client.end();

    // `count: 1` undoes only the most recently applied migration (this one).
    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      count: 1,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const droppedIndexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`,
      [TRGM_INDEXES.map((i) => i.index)],
    );
    expect(droppedIndexes.rows).toHaveLength(0);

    // Deliberately left installed — see this migration's own down-migration
    // comment.
    const extensionStillInstalled = await client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    expect(extensionStillInstalled.rows).toHaveLength(1);

    const survivingPlantTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'plants_inventory' AND table_name = 'plant'`,
    );
    expect(survivingPlantTable.rows).toHaveLength(1);
  });
});
