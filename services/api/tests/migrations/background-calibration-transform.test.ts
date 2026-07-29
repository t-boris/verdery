/**
 * Migration tests for 1785500000000_background-calibration-transform.sql
 * (P6-PLAN-02): the calibration table's known-distance/manual-adjustment
 * inputs and derived similarity-transform columns, the relaxed
 * reference-points rule, and the widened `calibration_state` CHECK on
 * `imported_background_details`.
 *
 * Source: implementation-plan.md work package P6-PLAN-02;
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

const SUITE_NAME = 'background calibration transform migration';

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
  let backgroundObjectId: string;

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
    backgroundObjectId = randomUUID();
    const coordinateSpaceId = randomUUID();

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
  }

  const insertCalibration = (overrides: Row = {}) => {
    const row: Row = {
      id: randomUUID(),
      background_object_id: backgroundObjectId,
      revision: 1,
      reference_points: JSON.stringify([]),
      created_by_profile_id: profileId,
      known_distance: JSON.stringify({
        pointA: [0.1, 0.1],
        pointB: [0.6, 0.1],
        distanceMetres: 10,
      }),
      page_aspect_ratio: 0.75,
      metres_per_plan_unit: 20,
      rotation_radians: 0,
      translation_x_metres: 0,
      translation_y_metres: 0,
      ...overrides,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    return client.query(
      `INSERT INTO gardens_mapping.calibration (${columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
  };

  it('stores a full P6-PLAN-02 calibration row: inputs, derived transform, residual columns', async () => {
    await freshBackground();
    await insertCalibration({
      reference_points: JSON.stringify([{ planPoint: [0, 0], localMetres: [2, 1] }]),
      manual_adjustment: JSON.stringify({
        rotationRadians: 0.1,
        translationMetres: { dx: 1, dy: -1 },
      }),
      point_residuals_metres: JSON.stringify([0]),
      residual_error_metres: null,
    });

    const row = await client.query<Row>(
      `SELECT known_distance, page_aspect_ratio, manual_adjustment, metres_per_plan_unit,
              rotation_radians, translation_x_metres, translation_y_metres,
              point_residuals_metres, residual_error_metres
         FROM gardens_mapping.calibration
        WHERE background_object_id = $1`,
      [backgroundObjectId],
    );
    expect(row.rows[0]).toEqual({
      known_distance: { pointA: [0.1, 0.1], pointB: [0.6, 0.1], distanceMetres: 10 },
      page_aspect_ratio: 0.75,
      manual_adjustment: { rotationRadians: 0.1, translationMetres: { dx: 1, dy: -1 } },
      metres_per_plan_unit: 20,
      rotation_radians: 0,
      translation_x_metres: 0,
      translation_y_metres: 0,
      point_residuals_metres: [0],
      residual_error_metres: null,
    });
  });

  it('still accepts a legacy P3-shaped row: reference points only, no transform', async () => {
    await freshBackground();
    await insertCalibration({
      reference_points: JSON.stringify([{ imagePixel: [0, 0], localMetres: [0, 0] }]),
      known_distance: null,
      page_aspect_ratio: null,
      metres_per_plan_unit: null,
      rotation_radians: null,
      translation_x_metres: null,
      translation_y_metres: null,
    });

    const row = await client.query<{ metres_per_plan_unit: number | null }>(
      'SELECT metres_per_plan_unit FROM gardens_mapping.calibration WHERE background_object_id = $1',
      [backgroundObjectId],
    );
    expect(row.rows[0]?.metres_per_plan_unit).toBeNull();
  });

  it('rejects a row with neither a known distance nor reference points', async () => {
    await freshBackground();

    await expect(
      insertCalibration({
        known_distance: null,
        page_aspect_ratio: null,
        metres_per_plan_unit: null,
        rotation_radians: null,
        translation_x_metres: null,
        translation_y_metres: null,
      }),
    ).rejects.toThrow(/calibration_inputs_present_check/);
  });

  it('rejects a partial transform — the derived transform is atomic', async () => {
    await freshBackground();

    await expect(insertCalibration({ rotation_radians: null })).rejects.toThrow(
      /calibration_transform_atomic_check/,
    );
  });

  it('rejects a non-positive scale and a non-positive page aspect ratio', async () => {
    await freshBackground();
    await expect(insertCalibration({ metres_per_plan_unit: 0 })).rejects.toThrow(
      /calibration_scale_positive_check/,
    );
    await expect(insertCalibration({ page_aspect_ratio: -1 })).rejects.toThrow(
      /calibration_page_aspect_ratio_positive_check/,
    );
  });

  it('accepts the calibrated details state the widened CHECK now allows', async () => {
    await freshBackground();
    const planMediaId = randomUUID();
    await client.query(
      `INSERT INTO media.media_record
         (id, garden_id, uploaded_by_profile_id, media_class, display_filename,
          declared_content_type, declared_byte_size, sensitivity_classification)
       VALUES ($1, $2, $3, 'imported_plan', 'plan.jpg', 'image/jpeg', 5000000, 'sensitive')`,
      [planMediaId, gardenId, profileId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.imported_background_details
         (garden_object_id, plan_media_id, calibration_state)
       VALUES ($1, $2, 'calibrated')`,
      [backgroundObjectId, planMediaId],
    );

    const row = await client.query<{ calibration_state: string }>(
      `SELECT calibration_state FROM gardens_mapping.imported_background_details
        WHERE garden_object_id = $1`,
      [backgroundObjectId],
    );
    expect(row.rows[0]?.calibration_state).toBe('calibrated');
  });

  it('rolls back: transform columns drop, the P3 reference-point rule returns, calibrated states reset', async () => {
    await freshBackground();
    // A P6-PLAN-02-shaped row with zero reference points cannot survive the
    // restored P3 CHECK; the rollback deletes it.
    await insertCalibration();

    await client.end();

    // `count: 23` undoes every newer migration (through
    // 1787700000000_plant-taxon-knowledge-profile.sql — nothing this
    // file's own assertions below check) first, then this migration itself.
    // Update again the next time a migration is added on top of that one.
    await migrate(databaseUrl, 'down', 23);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'gardens_mapping' AND table_name = 'calibration'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain('known_distance');
    expect(names).not.toContain('metres_per_plan_unit');
    expect(names).toContain('reference_points');
    expect(names).toContain('residual_error_metres');

    const survivors = await client.query<{ count: number }>(
      'SELECT count(*) AS count FROM gardens_mapping.calibration WHERE background_object_id = $1',
      [backgroundObjectId],
    );
    expect(survivors.rows[0]?.count).toBe(0);

    // The rollback's own UPDATE reset every calibrated row before
    // re-narrowing the CHECK.
    const calibrated = await client.query<{ count: number }>(
      `SELECT count(*) AS count FROM gardens_mapping.imported_background_details
        WHERE calibration_state <> 'uncalibrated'`,
    );
    expect(calibrated.rows[0]?.count).toBe(0);

    // The re-narrowed CHECK fires before the row's foreign keys are
    // evaluated (CHECKs are immediate; FKs are AFTER-row triggers), so the
    // deliberately dangling ids never get the chance to matter.
    await expect(
      client.query(
        `INSERT INTO gardens_mapping.imported_background_details
           (garden_object_id, plan_media_id, calibration_state)
         SELECT $1, $1, 'calibrated'`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/imported_background_details_calibration_state_check/);
  });
});
