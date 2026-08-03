/**
 * Migration test for `1787800000000_plant-search-extensions.sql`: the two
 * GIN trigram indexes backing P11-SEARCH-01's candidate and taxonomy-name
 * search — the exact `search-indexes.test.ts` shape, applied to the two new
 * indexes this migration adds.
 *
 * Source: implementation-plan.md work package P11-SEARCH-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { rollbackDepthTo } from '../support/migration-rollback-depth.js';

const SUITE_NAME = 'plant search extensions migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

async function migrate(
  databaseUrl: string,
  direction: 'up' | 'down',
  count: number,
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

const TRGM_INDEXES = [
  {
    schema: 'plants_inventory',
    table: 'plant_candidate',
    index: 'plant_candidate_display_name_trgm_idx',
  },
  { schema: 'plants_inventory', table: 'taxonomy_name', index: 'taxonomy_name_name_text_trgm_idx' },
] as const;

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;
  let gardenId: string;
  let taxonomyReferenceId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function freshFoundation(): Promise<void> {
    profileId = randomUUID();
    gardenId = randomUUID();
    taxonomyReferenceId = randomUUID();

    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
    await client.query(
      `INSERT INTO plants_inventory.taxonomy_reference (id, scientific_name, source)
       VALUES ($1, 'Ficus carica', 'system_catalog')`,
      [taxonomyReferenceId],
    );
  }

  it('creates both GIN trigram indexes using gin_trgm_ops', async () => {
    const result = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE indexname = ANY($1)`,
      [TRGM_INDEXES.map((i) => i.index)],
    );

    expect(result.rows).toHaveLength(TRGM_INDEXES.length);
    for (const row of result.rows) {
      expect(row.indexdef, row.indexname).toMatch(/USING gin/i);
      expect(row.indexdef, row.indexname).toMatch(/gin_trgm_ops/);
    }
  });

  it('finds a misspelled candidate display name that a plain ILIKE substring match would miss', async () => {
    await freshFoundation();
    const candidateId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.plant_candidate
         (id, garden_id, display_name, grouping_kind, status, created_by_profile_id)
       VALUES ($1, $2, 'Fig Sapling', 'individual', 'active', $3)`,
      [candidateId, gardenId, profileId],
    );

    const substringMatch = await client.query(
      `SELECT id FROM plants_inventory.plant_candidate WHERE display_name ILIKE $1`,
      ['%saplign%'],
    );
    expect(substringMatch.rows).toHaveLength(0);

    const trigramMatch = await client.query<{ id: string }>(
      `SELECT id FROM plants_inventory.plant_candidate WHERE similarity(display_name, $1) > 0.25`,
      ['fig saplign'],
    );
    expect(trigramMatch.rows.map((r) => r.id)).toEqual([candidateId]);
  });

  it('finds a misspelled synonym name that a plain ILIKE substring match would miss', async () => {
    await freshFoundation();
    const nameId = randomUUID();
    await client.query(
      `INSERT INTO plants_inventory.taxonomy_name
         (id, taxonomy_reference_id, name_kind, name_text, source)
       VALUES ($1, $2, 'synonym_scientific', 'Ficus carica var. hortensis', 'system_catalog')`,
      [nameId, taxonomyReferenceId],
    );

    const substringMatch = await client.query(
      `SELECT id FROM plants_inventory.taxonomy_name WHERE name_text ILIKE $1`,
      ['%hortenzis%'],
    );
    expect(substringMatch.rows).toHaveLength(0);

    const trigramMatch = await client.query<{ id: string }>(
      `SELECT id FROM plants_inventory.taxonomy_name WHERE similarity(name_text, $1) > 0.25`,
      ['ficus carica hortenzis'],
    );
    expect(trigramMatch.rows.map((r) => r.id)).toEqual([nameId]);
  });

  it('rolls back, leaving plant_candidate and taxonomy_name otherwise intact', async () => {
    await client.end();

    // Undoes every migration applied after this one, then this one. The
    // depth is derived from the migrations directory, so a migration added
    // on top needs no edit here.
    await migrate(databaseUrl, 'down', rollbackDepthTo('plant-search-extensions'));

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const droppedIndexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`,
      [TRGM_INDEXES.map((i) => i.index)],
    );
    expect(droppedIndexes.rows).toHaveLength(0);

    const survivingTables = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (
          ('plants_inventory', 'plant_candidate'),
          ('plants_inventory', 'taxonomy_name')
        )`,
    );
    expect(survivingTables.rows).toHaveLength(2);

    await migrate(databaseUrl, 'up', 3);
  });
});
