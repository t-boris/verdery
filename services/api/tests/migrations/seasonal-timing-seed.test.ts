/**
 * Migration tests for `migrations/1789600000000_seasonal-timing-seed.sql`.
 *
 * The point of this suite is the SAFETY property, not the row count: every
 * seeded row must be invisible to the rules until a human signs it off, and
 * the seed must not be able to forge that sign-off. A regression here would
 * not look like a failure — it would look like recommendations appearing.
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'seasonal timing seed migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('seeds taxa with the family the rotation rule needs', async () => {
    const rows = await pool.query<{ scientific_name: string; family: string }>(
      `SELECT scientific_name, family FROM plants_inventory.taxonomy_reference
       WHERE source = 'system_catalog' ORDER BY scientific_name`,
    );

    expect(rows.rowCount).toBeGreaterThanOrEqual(15);
    // Crop rotation compares families, so a taxon without one is invisible
    // to it however good its timing is.
    for (const row of rows.rows) {
      expect(row.family).not.toBeNull();
    }
  });

  it('leaves EVERY seeded fact awaiting review — the seed cannot forge a sign-off', async () => {
    const rows = await pool.query<{ review_status: string; reviewed_by: string | null }>(
      `SELECT review_status, reviewed_by FROM plants_inventory.taxonomy_seasonal_fact`,
    );

    expect(rows.rowCount).toBeGreaterThanOrEqual(15);
    for (const row of rows.rows) {
      expect(row.review_status).toBe('awaiting_horticultural_review');
      expect(row.reviewed_by).toBeNull();
    }
  });

  it('carries a real source citation on every row, as the extraction lane requires', async () => {
    const rows = await pool.query<{ authoring_method: string; source_citation: string | null }>(
      `SELECT authoring_method, source_citation FROM plants_inventory.taxonomy_seasonal_fact`,
    );

    for (const row of rows.rows) {
      expect(row.authoring_method).toBe('ai_extracted_from_source');
      expect(row.source_citation).toBeTruthy();
    }
  });

  it('is invisible to the rule-facing read until a reviewer approves', async () => {
    const before = await pool.query(
      `SELECT 1 FROM plants_inventory.taxonomy_seasonal_fact
       WHERE hemisphere = 'northern' AND review_status = 'horticulturally_reviewed'`,
    );
    expect(before.rowCount).toBe(0);

    // Exactly what the review command does, so the seed is provably
    // promotable rather than a dead end.
    await pool.query(
      `UPDATE plants_inventory.taxonomy_seasonal_fact
       SET review_status = 'horticulturally_reviewed',
           reviewed_by = 'reviewer@example.test',
           reviewed_on = CURRENT_DATE
       WHERE id = (SELECT id FROM plants_inventory.taxonomy_seasonal_fact LIMIT 1)`,
    );

    const after = await pool.query(
      `SELECT 1 FROM plants_inventory.taxonomy_seasonal_fact
       WHERE review_status = 'horticulturally_reviewed'`,
    );
    expect(after.rowCount).toBe(1);
  });

  it('is idempotent — re-running the seed adds nothing', async () => {
    const before = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM plants_inventory.taxonomy_seasonal_fact`,
    );

    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'down',
      count: 1,
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });
    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });

    const after = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM plants_inventory.taxonomy_seasonal_fact`,
    );
    // The down migration deliberately spares a reviewed row, so the count
    // returns to the same total rather than duplicating the seed.
    expect(Number(after.rows[0]?.count)).toBe(Number(before.rows[0]?.count));
  });
});
