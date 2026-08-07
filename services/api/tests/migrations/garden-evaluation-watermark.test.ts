/**
 * Migration tests for `migrations/1789200000000_garden-evaluation-watermark.sql`,
 * run BOTH directions against real Postgres — the convention every sibling
 * in this directory follows.
 *
 * Covers what the table exists to guarantee: one row per garden, the
 * cascade that keeps a deleted garden from being blocked by pure derived
 * bookkeeping, and the down migration leaving nothing behind.
 *
 * The DUE-garden query that reads this table is exercised separately, in
 * the integration suite, because its correctness is about relationships to
 * four other tables rather than about this table's own constraints.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'garden evaluation watermark migration';
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

  async function seedGarden(): Promise<string> {
    const profileId = randomUUID();
    const gardenId = randomUUID();
    await pool.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await pool.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id)
       VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
    return gardenId;
  }

  it('holds at most one watermark per garden, and an upsert moves it forward', async () => {
    const gardenId = await seedGarden();
    const first = new Date('2026-08-07T09:00:00Z');
    const second = new Date('2026-08-07T09:05:00Z');

    await pool.query(
      `INSERT INTO tasks_recommendations.garden_evaluation_state (garden_id, last_evaluated_at)
       VALUES ($1, $2)
       ON CONFLICT (garden_id) DO UPDATE SET last_evaluated_at = EXCLUDED.last_evaluated_at`,
      [gardenId, first],
    );
    await pool.query(
      `INSERT INTO tasks_recommendations.garden_evaluation_state (garden_id, last_evaluated_at)
       VALUES ($1, $2)
       ON CONFLICT (garden_id) DO UPDATE SET last_evaluated_at = EXCLUDED.last_evaluated_at`,
      [gardenId, second],
    );

    const rows = await pool.query<{ last_evaluated_at: Date }>(
      `SELECT last_evaluated_at FROM tasks_recommendations.garden_evaluation_state
       WHERE garden_id = $1`,
      [gardenId],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.last_evaluated_at.toISOString()).toBe(second.toISOString());
  });

  it('cascades on garden deletion — derived bookkeeping never blocks deleting a garden', async () => {
    const gardenId = await seedGarden();
    await pool.query(
      `INSERT INTO tasks_recommendations.garden_evaluation_state (garden_id, last_evaluated_at)
       VALUES ($1, now())`,
      [gardenId],
    );

    await pool.query(`DELETE FROM gardens_mapping.garden WHERE id = $1`, [gardenId]);

    const rows = await pool.query(
      `SELECT 1 FROM tasks_recommendations.garden_evaluation_state WHERE garden_id = $1`,
      [gardenId],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('refuses a watermark for a garden that does not exist', async () => {
    await expect(
      pool.query(
        `INSERT INTO tasks_recommendations.garden_evaluation_state (garden_id, last_evaluated_at)
         VALUES ($1, now())`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('drops cleanly on the down migration', async () => {
    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'down',
      count: 1,
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });

    const rows = await pool.query(
      `SELECT to_regclass('tasks_recommendations.garden_evaluation_state') AS present`,
    );
    expect(rows.rows[0]).toEqual({ present: null });

    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      log: () => undefined,
    });
  });
});
