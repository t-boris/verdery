/**
 * Migration tests for the plants, observations, and tasks baseline: plant
 * instances and their photo/identification history, the append-only
 * observation and image-analysis-result trail, manual tasks, and the
 * minimal media schema they all attach photos through.
 *
 * Source: implementation-plan.md work packages P4-DATA-01, P4-DATA-02,
 *         P4-DATA-03; architecture/testing-strategy.md, section
 *         "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';

const SUITE_NAME = 'plants observations tasks baseline migration';

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
  'media.media_record',
  'plants_inventory.taxonomy_reference',
  'plants_inventory.plant',
  'plants_inventory.plant_photo',
  'plants_inventory.plant_identification',
  'plants_inventory.plant_revision',
  'observations_history.observation',
  'observations_history.observation_photo',
  'observations_history.image_analysis_result',
  'tasks_recommendations.task',
  'tasks_recommendations.task_attachment',
  'tasks_recommendations.task_revision',
] as const;

const NEW_TABLE_TUPLES = NEW_TABLES.map((t) => {
  const [schema, table] = t.split('.');
  return `('${schema}', '${table}')`;
}).join(', ');

const BED_POLYGON_WKT = 'POLYGON((0 0, 5 0, 5 5, 0 5, 0 0))';

type Row = Record<string, unknown>;

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

  // Generic row insert: builds `INSERT INTO table (cols...) VALUES (...)`
  // from a plain object, so each test states only the columns it cares
  // about instead of repeating full INSERT statements. Returns the row's
  // `id` where the table has one (every table here except the two revision
  // journals, which are keyed by an identity `sequence` instead).
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

  // Fresh profile and garden before every test that needs one — called
  // explicitly rather than wired into a vitest beforeEach, mirroring
  // garden-map-baseline.test.ts's freshGarden() helper.
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

  /** A bed-category garden object in `gardenId`, for area-level target/observation tests. */
  async function insertGardenObject(): Promise<string> {
    const coordinateSpaceId = randomUUID();
    const objectId = randomUUID();

    await client.query(
      `INSERT INTO gardens_mapping.coordinate_space (id, garden_id, origin_description)
       VALUES ($1, $2, 'Southwest corner of the lot')`,
      [coordinateSpaceId, gardenId],
    );
    await client.query(
      `INSERT INTO gardens_mapping.garden_object
         (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
       VALUES ($1, $2, $3, 'bed', ST_GeomFromText($4, 0), 'manualDrawing', $5)`,
      [objectId, gardenId, coordinateSpaceId, BED_POLYGON_WKT, profileId],
    );

    return objectId;
  }

  const insertMediaRecord = (overrides: Row = {}) =>
    insertRow(
      'media.media_record',
      withId({
        storage_reference: 'gs://verdery-media/example.jpg',
        mime_type: 'image/jpeg',
        uploaded_by_profile_id: profileId,
        ...overrides,
      }),
    );

  const insertTaxonomyReference = (overrides: Row = {}) =>
    insertRow(
      'plants_inventory.taxonomy_reference',
      withId({ scientific_name: 'Solanum lycopersicum', source: 'system_catalog', ...overrides }),
    );

  const insertPlant = (overrides: Row = {}) =>
    insertRow(
      'plants_inventory.plant',
      withId({
        garden_id: gardenId,
        display_name: 'Tomato #1',
        created_by_profile_id: profileId,
        ...overrides,
      }),
    );

  const insertPlantPhoto = (overrides: Row) =>
    insertRow('plants_inventory.plant_photo', withId(overrides));

  const insertPlantIdentification = (overrides: Row) =>
    insertRow(
      'plants_inventory.plant_identification',
      withId({ confidence_score: 0.874, ...overrides }),
    );

  const insertObservation = (overrides: Row = {}) =>
    insertRow(
      'observations_history.observation',
      withId({
        garden_id: gardenId,
        created_by_profile_id: profileId,
        note_text: 'Field note',
        ...overrides,
      }),
    );

  const insertObservationPhoto = (overrides: Row) =>
    insertRow('observations_history.observation_photo', withId(overrides));

  const insertImageAnalysisResult = (overrides: Row) =>
    insertRow(
      'observations_history.image_analysis_result',
      withId({
        analysis_kind: 'pest',
        suggested_label: 'aphids',
        confidence_score: 0.612,
        ...overrides,
      }),
    );

  const insertTask = (overrides: Row = {}) =>
    insertRow(
      'tasks_recommendations.task',
      withId({
        garden_id: gardenId,
        target_kind: 'garden',
        title: 'Water the whole garden',
        created_by_profile_id: profileId,
        ...overrides,
      }),
    );

  const insertTaskAttachment = (overrides: Row) =>
    insertRow('tasks_recommendations.task_attachment', withId(overrides));

  it('creates every media, plants, observations, and tasks table', async () => {
    const result = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (${NEW_TABLE_TUPLES})`,
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
        WHERE (table_schema, table_name) IN (${NEW_TABLE_TUPLES})`,
    );

    expect(result.rows).toHaveLength(NEW_TABLES.length);
    for (const row of result.rows) {
      expect(row.can_select, `${row.qualified} SELECT`).toBe(true);
      expect(row.can_insert, `${row.qualified} INSERT`).toBe(true);
    }
  });

  it('inserts an immutable media record', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();

    const row = await client.query<{ mime_type: string }>(
      'SELECT mime_type FROM media.media_record WHERE id = $1',
      [mediaId],
    );
    expect(row.rows[0]?.mime_type).toBe('image/jpeg');
  });

  it('accepts system-catalog and user-defined taxonomy references, and rejects an unknown source', async () => {
    await freshFoundation();

    await insertTaxonomyReference({ source: 'system_catalog' });
    await insertTaxonomyReference({ source: 'user_defined', created_by_profile_id: profileId });

    await expect(insertTaxonomyReference({ source: 'guess' })).rejects.toThrow(
      /taxonomy_reference_source_check/,
    );
  });

  it('creates a plant with documented defaults and rejects each invalid enumerated field', async () => {
    await freshFoundation();
    const plantId = await insertPlant();

    const row = await client.query<{
      grouping_kind: string;
      lifecycle_stage: string;
      status: string;
      revision: number;
    }>(
      'SELECT grouping_kind, lifecycle_stage, status, revision FROM plants_inventory.plant WHERE id = $1',
      [plantId],
    );
    expect(row.rows[0]).toEqual({
      grouping_kind: 'individual',
      lifecycle_stage: 'planned',
      status: 'active',
      revision: 1,
    });

    await expect(insertPlant({ grouping_kind: 'cluster' })).rejects.toThrow(
      /plant_grouping_kind_check/,
    );
    await expect(insertPlant({ lifecycle_stage: 'blooming' })).rejects.toThrow(
      /plant_lifecycle_stage_check/,
    );
    await expect(insertPlant({ status: 'thriving' })).rejects.toThrow(/plant_status_check/);
    await expect(insertPlant({ acquisition_date_type: 'found' })).rejects.toThrow(
      /plant_acquisition_date_type_check/,
    );
    await expect(insertPlant({ quantity: 0 })).rejects.toThrow(/plant_quantity_positive_check/);
  });

  it('allows only one primary photo per plant, but any number of non-primary photos', async () => {
    await freshFoundation();
    const plantId = await insertPlant();
    const mediaOne = await insertMediaRecord();
    const mediaTwo = await insertMediaRecord();
    const mediaThree = await insertMediaRecord();

    await insertPlantPhoto({ plant_id: plantId, media_id: mediaOne, is_primary: true });
    await insertPlantPhoto({ plant_id: plantId, media_id: mediaTwo, is_primary: false });

    await expect(
      insertPlantPhoto({ plant_id: plantId, media_id: mediaThree, is_primary: true }),
    ).rejects.toThrow(/plant_photo_plant_primary_idx/);
  });

  it('records photo-ID evidence and lets the plant accept one via the deferred FK', async () => {
    await freshFoundation();
    const plantId = await insertPlant();
    const mediaId = await insertMediaRecord();
    const photoId = await insertPlantPhoto({ plant_id: plantId, media_id: mediaId });
    const taxonomyId = await insertTaxonomyReference();

    const identificationId = await insertPlantIdentification({
      plant_id: plantId,
      plant_photo_id: photoId,
      suggested_taxonomy_id: taxonomyId,
    });

    await client.query(
      'UPDATE plants_inventory.plant SET accepted_identification_id = $1 WHERE id = $2',
      [identificationId, plantId],
    );

    await expect(
      client.query(
        'UPDATE plants_inventory.plant SET accepted_identification_id = $1 WHERE id = $2',
        [randomUUID(), plantId],
      ),
    ).rejects.toThrow(/plant_accepted_identification_id_fkey/);
  });

  it('writes an immutable plant revision journal entry, one per revision number', async () => {
    await freshFoundation();
    const plantId = await insertPlant();
    const revision = {
      plant_id: plantId,
      revision: 1,
      command_type: 'addPlant',
      status: 'active',
      actor_profile_id: profileId,
    };

    await insertRow('plants_inventory.plant_revision', revision);

    await expect(
      insertRow('plants_inventory.plant_revision', { ...revision, command_type: 'editPlant' }),
    ).rejects.toThrow(/plant_revision_plant_id_revision_key/);
  });

  it('records a plant-level and an area-level observation, and rejects an unknown actor type', async () => {
    await freshFoundation();
    const plantId = await insertPlant();
    const gardenObjectId = await insertGardenObject();

    await insertObservation({ plant_id: plantId, note_text: 'Leaves look healthy' });
    await insertObservation({
      garden_object_id: gardenObjectId,
      condition_summary: 'Bed soil looks dry',
    });

    await expect(insertObservation({ actor_type: 'robot' })).rejects.toThrow(
      /observation_actor_type_check/,
    );
  });

  it('accepts a correcting observation paired with corrects_observation_id, and rejects an inconsistent pairing', async () => {
    await freshFoundation();
    const originalId = await insertObservation({ note_text: 'Original note' });

    await insertObservation({
      note_text: 'Corrected note',
      correction_kind: 'amendment',
      corrects_observation_id: originalId,
    });

    await expect(
      insertObservation({ note_text: 'Missing target', correction_kind: 'amendment' }),
    ).rejects.toThrow(/observation_correction_consistency_check/);

    await expect(
      insertObservation({ note_text: 'Missing kind', corrects_observation_id: originalId }),
    ).rejects.toThrow(/observation_correction_consistency_check/);

    await expect(
      insertObservation({
        note_text: 'Bad kind',
        correction_kind: 'undo',
        corrects_observation_id: originalId,
      }),
    ).rejects.toThrow(/observation_correction_kind_check/);
  });

  it('attaches a photo to an observation', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();
    const observationId = await insertObservation({ note_text: 'Spotted a photo-worthy leaf' });

    await insertObservationPhoto({ observation_id: observationId, media_id: mediaId });

    const row = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM observations_history.observation_photo WHERE observation_id = $1',
      [observationId],
    );
    expect(row.rows[0]?.count).toBe(1);
  });

  it('defaults requires_confirmation to true and rejects an unrecognized analysis kind', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();
    const observationId = await insertObservation({ note_text: 'Possible pest damage' });
    const photoId = await insertObservationPhoto({
      observation_id: observationId,
      media_id: mediaId,
    });

    const resultId = await insertImageAnalysisResult({ observation_photo_id: photoId });

    const row = await client.query<{ requires_confirmation: boolean }>(
      'SELECT requires_confirmation FROM observations_history.image_analysis_result WHERE id = $1',
      [resultId],
    );
    expect(row.rows[0]?.requires_confirmation).toBe(true);

    await expect(
      insertImageAnalysisResult({ observation_photo_id: photoId, analysis_kind: 'infestation' }),
    ).rejects.toThrow(/image_analysis_result_analysis_kind_check/);
  });

  it('accepts a garden-level, area-level, and plant-level task, and rejects a mismatched target', async () => {
    await freshFoundation();
    const plantId = await insertPlant();
    const gardenObjectId = await insertGardenObject();

    await insertTask();
    await insertTask({
      target_kind: 'garden_area',
      target_garden_area_id: gardenObjectId,
      title: 'Mulch the bed',
    });
    await insertTask({ target_kind: 'plant', target_plant_id: plantId, title: 'Prune the tomato' });

    await expect(
      insertTask({
        target_kind: 'plant',
        target_plant_id: plantId,
        target_garden_area_id: gardenObjectId,
        title: 'Ambiguous target',
      }),
    ).rejects.toThrow(/task_target_consistency_check/);
  });

  it('defaults task status, urgency, and source, and rejects each invalid enumerated value', async () => {
    await freshFoundation();
    const taskId = await insertTask();

    const row = await client.query<{ status: string; urgency: string; source: string }>(
      'SELECT status, urgency, source FROM tasks_recommendations.task WHERE id = $1',
      [taskId],
    );
    expect(row.rows[0]).toEqual({ status: 'planned', urgency: 'normal', source: 'manual' });

    await expect(insertTask({ status: 'archived' })).rejects.toThrow(/task_status_check/);
    await expect(insertTask({ urgency: 'critical' })).rejects.toThrow(/task_urgency_check/);
    await expect(insertTask({ source: 'automated' })).rejects.toThrow(/task_source_check/);
  });

  it('attaches media to a task', async () => {
    await freshFoundation();
    const mediaId = await insertMediaRecord();
    const taskId = await insertTask();

    await insertTaskAttachment({ task_id: taskId, media_id: mediaId });

    const row = await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM tasks_recommendations.task_attachment WHERE task_id = $1',
      [taskId],
    );
    expect(row.rows[0]?.count).toBe(1);
  });

  it('writes an immutable task revision journal entry, one per revision number', async () => {
    await freshFoundation();
    const taskId = await insertTask();
    const revision = {
      task_id: taskId,
      revision: 1,
      command_type: 'createTask',
      status: 'planned',
      actor_profile_id: profileId,
    };

    await insertRow('tasks_recommendations.task_revision', revision);

    await expect(
      insertRow('tasks_recommendations.task_revision', { ...revision, command_type: 'editTask' }),
    ).rejects.toThrow(/task_revision_task_id_revision_key/);
  });

  it('rolls back, leaving the garden-map-baseline schemas and tables otherwise intact', async () => {
    await client.end();

    // `count: 3` undoes this migration and every migration applied after it
    // (currently search-indexes, which adds indexes on tables this one
    // creates, and synchronization-baseline, neither of which needs to come
    // down for its own sake but both of which were applied later and must
    // unwind first). Update this count when a later migration is added on
    // top.
    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      count: 3,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const dropped = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE (table_schema, table_name) IN (${NEW_TABLE_TUPLES})`,
    );
    expect(dropped.rows).toHaveLength(0);

    const survivingGardenObjectTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'gardens_mapping' AND table_name = 'garden_object'`,
    );
    expect(survivingGardenObjectTable.rows).toHaveLength(1);
  });
});
