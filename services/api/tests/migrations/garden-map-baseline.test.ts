/**
 * Migration tests for the garden map baseline: coordinate spaces, garden
 * objects and their category-specific detail tables, the revision journal,
 * and calibration.
 *
 * Source: implementation-plan.md work packages P3-DATA-01, P3-DATA-02;
 *         architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'garden map baseline migration';

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
  'gardens_mapping.coordinate_space',
  'gardens_mapping.georeference',
  'gardens_mapping.garden_object',
  'gardens_mapping.structure_details',
  'gardens_mapping.fence_details',
  'gardens_mapping.gate_details',
  'gardens_mapping.zone_details',
  'gardens_mapping.bed_details',
  'gardens_mapping.tree_details',
  'gardens_mapping.plant_placement_details',
  'gardens_mapping.utility_exclusion_details',
  'gardens_mapping.annotation_details',
  'gardens_mapping.garden_object_revision',
  'gardens_mapping.calibration',
] as const;

const SQUARE_POLYGON_WKT = 'POLYGON((0 0, 5 0, 5 5, 0 5, 0 0))';

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;
  let gardenId: string;
  let coordinateSpaceId: string;

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

  // Fresh profile, garden, and coordinate space before every test that needs
  // one — called explicitly rather than wired into a vitest beforeEach,
  // since several tests need to assert on a clean
  // coordinate_space_garden_id_idx uniqueness.
  async function freshGarden(): Promise<void> {
    profileId = randomUUID();
    gardenId = randomUUID();
    coordinateSpaceId = randomUUID();

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
  }

  it('creates every garden map table', async () => {
    const result = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'gardens_mapping'
          AND table_name IN (${NEW_TABLES.map((t) => `'${t.split('.')[1]}'`).join(', ')})`,
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
        WHERE table_schema = 'gardens_mapping'
          AND table_name IN (${NEW_TABLES.map((t) => `'${t.split('.')[1]}'`).join(', ')})`,
    );

    expect(result.rows).toHaveLength(NEW_TABLES.length);
    for (const row of result.rows) {
      expect(row.can_select, `${row.qualified} SELECT`).toBe(true);
      expect(row.can_insert, `${row.qualified} INSERT`).toBe(true);
    }
  });

  it('accepts a lot polygon and rejects a point for the same category', async () => {
    await freshGarden();

    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'lot', ST_GeomFromText($4, 0), 'manualDrawing', $5)`,
      [randomUUID(), gardenId, coordinateSpaceId, SQUARE_POLYGON_WKT, profileId],
    );

    await expect(
      client.query(
        `INSERT INTO gardens_mapping.garden_object
           (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
         VALUES ($1, $2, $3, 'lot', ST_GeomFromText('POINT(1 1)', 0), 'manualDrawing', $4)`,
        [randomUUID(), gardenId, coordinateSpaceId, profileId],
      ),
    ).rejects.toThrow(/garden_object_geometry_type_check/);
  });

  it('accepts a tree trunk point and a valid canopy polygon', async () => {
    await freshGarden();
    const treeId = randomUUID();

    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'tree', ST_GeomFromText('POINT(2 2)', 0), 'manualDrawing', $4)`,
      [treeId, gardenId, coordinateSpaceId, profileId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.tree_details (garden_object_id, canopy_geometry, common_name)
       VALUES ($1, ST_GeomFromText($2, 0), 'Japanese maple')`,
      [treeId, SQUARE_POLYGON_WKT],
    );

    const row = await client.query<{ common_name: string }>(
      'SELECT common_name FROM gardens_mapping.tree_details WHERE garden_object_id = $1',
      [treeId],
    );
    expect(row.rows[0]?.common_name).toBe('Japanese maple');
  });

  it('rejects a self-intersecting garden object geometry', async () => {
    await freshGarden();
    const bowtie = 'POLYGON((0 0, 5 5, 5 0, 0 5, 0 0))';

    await expect(
      client.query(
        `INSERT INTO gardens_mapping.garden_object
           (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
         VALUES ($1, $2, $3, 'zone', ST_GeomFromText($4, 0), 'manualDrawing', $5)`,
        [randomUUID(), gardenId, coordinateSpaceId, bowtie, profileId],
      ),
    ).rejects.toThrow(/garden_object_geometry_valid_check/);
  });

  it('rejects an unrecognized category', async () => {
    await freshGarden();

    await expect(
      client.query(
        `INSERT INTO gardens_mapping.garden_object
           (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
         VALUES ($1, $2, $3, 'swimmingPool', ST_GeomFromText('POINT(1 1)', 0), 'manualDrawing', $4)`,
        [randomUUID(), gardenId, coordinateSpaceId, profileId],
      ),
    ).rejects.toThrow(/garden_object_category_check/);
  });

  it('a gate references exactly one fence object', async () => {
    await freshGarden();
    const fenceId = randomUUID();
    const gateId = randomUUID();

    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'fence', ST_GeomFromText('LINESTRING(0 0, 10 0)', 0), 'manualDrawing', $4)`,
      [fenceId, gardenId, coordinateSpaceId, profileId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'gate', ST_GeomFromText('POINT(5 0)', 0), 'manualDrawing', $4)`,
      [gateId, gardenId, coordinateSpaceId, profileId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.gate_details (garden_object_id, fence_object_id, width_metres)
       VALUES ($1, $2, 1.2)`,
      [gateId, fenceId],
    );

    const row = await client.query<{ fence_object_id: string }>(
      'SELECT fence_object_id FROM gardens_mapping.gate_details WHERE garden_object_id = $1',
      [gateId],
    );
    expect(row.rows[0]?.fence_object_id).toBe(fenceId);
  });

  it('allows only one current georeference per garden, but keeps history', async () => {
    await freshGarden();

    await client.query(
      `INSERT INTO gardens_mapping.georeference
         (id, garden_id, coordinate_space_id, local_anchor, geographic_anchor, provenance, method, created_by_profile_id)
       VALUES ($1, $2, $3, ST_GeomFromText('POINT(0 0)', 0), ST_GeomFromText('POINT(-122.4 37.8)', 4326), 'userMeasurement', 'manual', $4)`,
      [randomUUID(), gardenId, coordinateSpaceId, profileId],
    );

    await expect(
      client.query(
        `INSERT INTO gardens_mapping.georeference
           (id, garden_id, coordinate_space_id, local_anchor, geographic_anchor, provenance, method, created_by_profile_id)
         VALUES ($1, $2, $3, ST_GeomFromText('POINT(1 1)', 0), ST_GeomFromText('POINT(-122.5 37.9)', 4326), 'userMeasurement', 'manual', $4)`,
        [randomUUID(), gardenId, coordinateSpaceId, profileId],
      ),
    ).rejects.toThrow(/georeference_garden_current_idx/);

    // Superseding the old one first (valid_until set) allows a new current row.
    await client.query(
      `UPDATE gardens_mapping.georeference SET valid_until = now() WHERE garden_id = $1`,
      [gardenId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.georeference
         (id, garden_id, coordinate_space_id, local_anchor, geographic_anchor, provenance, method, created_by_profile_id)
       VALUES ($1, $2, $3, ST_GeomFromText('POINT(1 1)', 0), ST_GeomFromText('POINT(-122.5 37.9)', 4326), 'userMeasurement', 'manual', $4)`,
      [randomUUID(), gardenId, coordinateSpaceId, profileId],
    );

    const current = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM gardens_mapping.georeference WHERE garden_id = $1 AND valid_until IS NULL',
      [gardenId],
    );
    expect(current.rows[0]?.count).toBe(1);

    const total = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM gardens_mapping.georeference WHERE garden_id = $1',
      [gardenId],
    );
    expect(total.rows[0]?.count).toBe(2);
  });

  it('writes an immutable revision journal entry independent of the object row', async () => {
    await freshGarden();
    const objectId = randomUUID();

    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'zone', ST_GeomFromText($4, 0), 'manualDrawing', $5)`,
      [objectId, gardenId, coordinateSpaceId, SQUARE_POLYGON_WKT, profileId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.garden_object_revision
         (garden_object_id, revision, command_type, geometry, lifecycle_state, actor_profile_id)
       VALUES ($1, 1, 'createObject', ST_GeomFromText($2, 0), 'active', $3)`,
      [objectId, SQUARE_POLYGON_WKT, profileId],
    );

    await expect(
      client.query(
        `INSERT INTO gardens_mapping.garden_object_revision
           (garden_object_id, revision, command_type, geometry, lifecycle_state, actor_profile_id)
         VALUES ($1, 1, 'moveObject', ST_GeomFromText($2, 0), 'active', $3)`,
        [objectId, SQUARE_POLYGON_WKT, profileId],
      ),
    ).rejects.toThrow(/garden_object_revision_object_revision_key/);

    const rows = await client.query(
      'SELECT revision, command_type FROM gardens_mapping.garden_object_revision WHERE garden_object_id = $1 ORDER BY revision',
      [objectId],
    );
    expect(rows.rows).toEqual([{ revision: '1', command_type: 'createObject' }]);
  });

  it('requires at least one calibration reference point', async () => {
    await freshGarden();
    const backgroundId = randomUUID();

    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'importedBackground', ST_GeomFromText($4, 0), 'importedPlan', $5)`,
      [backgroundId, gardenId, coordinateSpaceId, SQUARE_POLYGON_WKT, profileId],
    );

    await expect(
      client.query(
        `INSERT INTO gardens_mapping.calibration
           (id, background_object_id, reference_points, created_by_profile_id)
         VALUES ($1, $2, '[]'::jsonb, $3)`,
        [randomUUID(), backgroundId, profileId],
      ),
    ).rejects.toThrow(/calibration_reference_points_not_empty_check/);

    await client.query(
      `INSERT INTO gardens_mapping.calibration
         (id, background_object_id, reference_points, created_by_profile_id)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        randomUUID(),
        backgroundId,
        JSON.stringify([{ imagePixel: [0, 0], localMetres: [0, 0] }]),
        profileId,
      ],
    );
  });

  it('rolls back, leaving the identity-and-gardens-baseline schemas and tables otherwise intact', async () => {
    await client.end();

    // `count: 6` undoes this migration and every migration applied after it
    // (currently plants-observations-tasks-baseline, search-indexes,
    // synchronization-baseline, media-lifecycle-and-quotas, and
    // media-processing-jobs, each of which depends, directly or
    // transitively, on tables this one creates and must come down first).
    // Update this count when a later migration is added on top.
    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      count: 6,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const dropped = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'gardens_mapping'
          AND table_name IN (${NEW_TABLES.map((t) => `'${t.split('.')[1]}'`).join(', ')})`,
    );
    expect(dropped.rows).toHaveLength(0);

    const survivingGardenTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'gardens_mapping' AND table_name = 'garden'`,
    );
    expect(survivingGardenTable.rows).toHaveLength(1);
  });
});
