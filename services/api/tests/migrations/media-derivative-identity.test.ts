/**
 * Migration tests for the derivative-identity extension to
 * `media.media_record`: every new column and CHECK constraint, and the two
 * partial unique indexes that turn "regenerating the same derivative for
 * the same source and version is a safe no-op" into a real, database-
 * enforced guarantee.
 *
 * Source: implementation-plan.md work package P6-WORKER-02;
 *         architecture/media-storage-and-processing.md, section
 *         "9. Image Derivatives";
 *         architecture/testing-strategy.md, section
 *         "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'media derivative identity migration';

const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';

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
  let originalId: string;

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

  async function insertRow(table: string, row: Row): Promise<string> {
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
    return row['id'] as string;
  }

  function withId(row: Row): Row {
    return { id: randomUUID(), ...row };
  }

  async function freshOriginal(): Promise<void> {
    profileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    originalId = await insertRow(
      'media.media_record',
      withId({
        uploaded_by_profile_id: profileId,
        media_class: 'imported_plan',
        display_filename: 'plan.jpg',
        declared_content_type: 'image/jpeg',
        declared_byte_size: 5_000_000,
        sensitivity_classification: 'sensitive',
      }),
    );
  }

  const insertDerivative = (overrides: Row = {}) =>
    insertRow(
      'media.media_record',
      withId({
        uploaded_by_profile_id: profileId,
        media_class: 'derived_preview',
        display_filename: 'plan.jpg',
        declared_content_type: 'image/jpeg',
        declared_byte_size: 40_000,
        sensitivity_classification: 'standard',
        derived_from_media_id: originalId,
        transformation_version: 1,
        derivative_kind: 'thumbnail',
        ...overrides,
      }),
    );

  it('adds derivative_kind and the three tile coordinate columns', async () => {
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'media' AND table_name = 'media_record'
          AND column_name IN ('derivative_kind', 'tile_zoom_level', 'tile_x', 'tile_y')`,
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(
      ['derivative_kind', 'tile_x', 'tile_y', 'tile_zoom_level'].sort(),
    );
  });

  it('records a thumbnail derivative with no tile coordinates', async () => {
    await freshOriginal();
    const derivativeId = await insertDerivative();

    const row = await client.query<{
      derivative_kind: string;
      tile_zoom_level: number | null;
      tile_x: number | null;
      tile_y: number | null;
    }>(
      'SELECT derivative_kind, tile_zoom_level, tile_x, tile_y FROM media.media_record WHERE id = $1',
      [derivativeId],
    );
    expect(row.rows[0]).toEqual({
      derivative_kind: 'thumbnail',
      tile_zoom_level: null,
      tile_x: null,
      tile_y: null,
    });
  });

  it('records a tile derivative with its XYZ coordinates', async () => {
    await freshOriginal();
    const derivativeId = await insertDerivative({
      derivative_kind: 'tile',
      tile_zoom_level: 3,
      tile_x: 5,
      tile_y: 2,
    });

    const row = await client.query<{ tile_zoom_level: number; tile_x: number; tile_y: number }>(
      'SELECT tile_zoom_level, tile_x, tile_y FROM media.media_record WHERE id = $1',
      [derivativeId],
    );
    expect(row.rows[0]).toEqual({ tile_zoom_level: 3, tile_x: 5, tile_y: 2 });
  });

  it('rejects derivative_kind without derived_from_media_id or transformation_version', async () => {
    await freshOriginal();

    await expect(
      insertDerivative({ derived_from_media_id: null, transformation_version: null }),
    ).rejects.toThrow(/media_record_derivative_kind_requires_derivative_check/);
    await expect(insertDerivative({ transformation_version: null })).rejects.toThrow(
      /media_record_derivative_kind_requires_version_check/,
    );
  });

  it('rejects an unrecognized derivative_kind', async () => {
    await freshOriginal();

    await expect(insertDerivative({ derivative_kind: 'bogus' })).rejects.toThrow(
      /media_record_derivative_kind_check/,
    );
  });

  it('rejects a partial tile coordinate set, tile coordinates on a non-tile kind, and a negative coordinate', async () => {
    await freshOriginal();

    await expect(insertDerivative({ tile_zoom_level: 0 })).rejects.toThrow(
      /media_record_tile_coordinates_pairing_check/,
    );
    await expect(insertDerivative({ tile_zoom_level: 0, tile_x: 0, tile_y: 0 })).rejects.toThrow(
      /media_record_tile_coordinates_require_tile_kind_check/,
    );
    await expect(
      insertDerivative({
        derivative_kind: 'tile',
        tile_zoom_level: -1,
        tile_x: 0,
        tile_y: 0,
      }),
    ).rejects.toThrow(/media_record_tile_coordinates_non_negative_check/);
  });

  it('enforces at most one non-tile derivative per (original, version, kind)', async () => {
    await freshOriginal();
    await insertDerivative();

    await expect(insertDerivative()).rejects.toThrow(/media_record_derivative_identity_key/);

    // A different kind, or a different version, is a distinct identity —
    // never blocked by the same index.
    await insertDerivative({ derivative_kind: 'screen_preview' });
    await insertDerivative({ transformation_version: 2 });
  });

  it('enforces at most one tile per (original, version, zoom, x, y), but allows any number of distinct tiles', async () => {
    await freshOriginal();
    await insertDerivative({ derivative_kind: 'tile', tile_zoom_level: 0, tile_x: 0, tile_y: 0 });

    await expect(
      insertDerivative({ derivative_kind: 'tile', tile_zoom_level: 0, tile_x: 0, tile_y: 0 }),
    ).rejects.toThrow(/media_record_tile_derivative_identity_key/);

    // A different coordinate, or a different version, is a distinct tile —
    // never blocked by the same index.
    await insertDerivative({ derivative_kind: 'tile', tile_zoom_level: 0, tile_x: 1, tile_y: 0 });
    await insertDerivative({
      derivative_kind: 'tile',
      tile_zoom_level: 0,
      tile_x: 0,
      tile_y: 0,
      transformation_version: 2,
    });
  });

  it('rolls back, dropping derivative_kind and the three tile coordinate columns', async () => {
    await freshOriginal();
    await insertDerivative();

    await client.end();

    // `count: 8` undoes the seven newer migrations
    // (1785400000000_imported-background-details.sql through
    // 1786000000000_notifications-baseline.sql — nothing this
    // file's own assertions below check) first, then this migration itself.
    // Update again the next time a migration is added on top of that one.
    await migrate(databaseUrl, 'down', 8);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'media' AND table_name = 'media_record'
          AND column_name IN ('derivative_kind', 'tile_zoom_level', 'tile_x', 'tile_y')`,
    );
    expect(columns.rows).toHaveLength(0);

    // media.media_record itself, and the pre-existing derived_from_media_id/
    // transformation_version columns, are untouched by this rollback.
    const survivingColumns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'media' AND table_name = 'media_record'
          AND column_name IN ('derived_from_media_id', 'transformation_version')`,
    );
    expect(survivingColumns.rows).toHaveLength(2);
  });
});
