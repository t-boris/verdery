/**
 * Migration tests for `gardens_mapping.imported_background_details`
 * (P6-PLAN-01): the detail table the `importedBackground` category gains
 * once plan import can actually create one — plan-media reference, page
 * selection, per-background visibility, and the CHECK-pinned uncalibrated
 * state.
 *
 * Source: implementation-plan.md work package P6-PLAN-01;
 *         architecture/map-rendering-and-editing.md, section
 *         "16. Plan Import and Calibration";
 *         architecture/testing-strategy.md, section
 *         "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'imported background details migration';

const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const SQUARE_POLYGON_WKT = 'POLYGON((0 0, 5 0, 5 5, 0 5, 0 0))';

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
  let coordinateSpaceId: string;
  let backgroundObjectId: string;
  let planMediaId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function freshBackground(): Promise<void> {
    profileId = randomUUID();
    gardenId = randomUUID();
    coordinateSpaceId = randomUUID();
    backgroundObjectId = randomUUID();
    planMediaId = randomUUID();

    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.coordinate_space (id, garden_id, origin_description)
       VALUES ($1, $2, 'Southwest corner of the lot')`,
      [coordinateSpaceId, gardenId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'importedBackground', ST_GeomFromText($4, 0), 'importedPlan', $5)`,
      [backgroundObjectId, gardenId, coordinateSpaceId, SQUARE_POLYGON_WKT, profileId],
    );
    await client.query(
      `INSERT INTO media.media_record
         (id, garden_id, uploaded_by_profile_id, media_class, display_filename,
          declared_content_type, declared_byte_size, sensitivity_classification)
       VALUES ($1, $2, $3, 'imported_plan', 'plan.jpg', 'image/jpeg', 5000000, 'sensitive')`,
      [planMediaId, gardenId, profileId],
    );
  }

  const insertDetails = (overrides: Row = {}) => {
    const row: Row = {
      garden_object_id: backgroundObjectId,
      plan_media_id: planMediaId,
      ...overrides,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    return client.query(
      `INSERT INTO gardens_mapping.imported_background_details
         (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
  };

  it('records a background with its defaults: visible, uncalibrated, no page selected', async () => {
    await freshBackground();
    await insertDetails();

    const row = await client.query<{
      plan_media_id: string;
      source_page_number: number | null;
      is_background_visible: boolean;
      calibration_state: string;
    }>(
      `SELECT plan_media_id, source_page_number, is_background_visible, calibration_state
         FROM gardens_mapping.imported_background_details
        WHERE garden_object_id = $1`,
      [backgroundObjectId],
    );
    expect(row.rows[0]).toEqual({
      plan_media_id: planMediaId,
      source_page_number: null,
      is_background_visible: true,
      calibration_state: 'uncalibrated',
    });
  });

  it('records an explicit page selection and a hidden background', async () => {
    await freshBackground();
    await insertDetails({ source_page_number: 3, is_background_visible: false });

    const row = await client.query<{ source_page_number: number; is_background_visible: boolean }>(
      `SELECT source_page_number, is_background_visible
         FROM gardens_mapping.imported_background_details
        WHERE garden_object_id = $1`,
      [backgroundObjectId],
    );
    expect(row.rows[0]).toEqual({ source_page_number: 3, is_background_visible: false });
  });

  it('rejects a non-positive page number', async () => {
    await freshBackground();

    await expect(insertDetails({ source_page_number: 0 })).rejects.toThrow(
      /imported_background_details_page_number_positive_check/,
    );
  });

  it('accepts both calibration states and rejects anything else — the CHECK P6-PLAN-02 widened', async () => {
    await freshBackground();

    await expect(insertDetails({ calibration_state: 'approximate' })).rejects.toThrow(
      /imported_background_details_calibration_state_check/,
    );
    await insertDetails({ calibration_state: 'calibrated' });
  });

  it('rejects a plan media reference that does not exist', async () => {
    await freshBackground();

    await expect(insertDetails({ plan_media_id: randomUUID() })).rejects.toThrow(
      /imported_background_details_plan_media_id_fkey/,
    );
  });

  it('refuses to delete a media record a background still references — media deletion is a governed workflow, never a silent cascade', async () => {
    await freshBackground();
    await insertDetails();

    await expect(
      client.query('DELETE FROM media.media_record WHERE id = $1', [planMediaId]),
    ).rejects.toThrow(/imported_background_details_plan_media_id_fkey/);
  });

  it('cascades the detail row away with its own garden object, like every other detail table', async () => {
    await freshBackground();
    await insertDetails();

    await client.query('DELETE FROM gardens_mapping.garden_object WHERE id = $1', [
      backgroundObjectId,
    ]);

    const remaining = await client.query(
      'SELECT 1 FROM gardens_mapping.imported_background_details WHERE garden_object_id = $1',
      [backgroundObjectId],
    );
    expect(remaining.rows).toHaveLength(0);
  });

  it('rolls back, dropping the detail table and nothing else', async () => {
    await freshBackground();
    await insertDetails();

    await client.end();

    // `count: 30` undoes every newer migration (through
    // 1787800000000_plant-search-extensions.sql — nothing this
    // file's own assertions below check) first, then this migration itself.
    // Update again the next time a migration is added on top of that one.
    await migrate(databaseUrl, 'down', 30);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const table = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'gardens_mapping' AND table_name = 'imported_background_details'`,
    );
    expect(table.rows).toHaveLength(0);

    // The garden object and the media record themselves are untouched by
    // this rollback.
    // `count(*)` is int8, returned as a JS number under this suite's own
    // `pg-bigint-parser` import.
    const survivors = await client.query<{ count: number }>(
      `SELECT (SELECT count(*) FROM gardens_mapping.garden_object WHERE id = $1)
            + (SELECT count(*) FROM media.media_record WHERE id = $2) AS count`,
      [backgroundObjectId, planMediaId],
    );
    expect(survivors.rows[0]?.count).toBe(2);
  });
});
