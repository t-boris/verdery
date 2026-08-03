/**
 * Migration test for `1788400000000_observation-symptoms.sql`: the
 * `observation_symptom` table's shape, both closed vocabularies, the
 * one-row-per-symptom rule, and that `down` genuinely reverses `up`.
 *
 * Source: implementation-plan.md work package P11-MEDIA-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { rollbackDepthTo } from '../support/migration-rollback-depth.js';

const SUITE_NAME = 'observation symptoms migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let gardenId: string;
  let profileId: string;
  let observationId: string;

  async function migrate(direction: 'up' | 'down', count: number): Promise<void> {
    await runner({
      databaseUrl: container.getConnectionUri(),
      dir: MIGRATIONS_DIRECTORY,
      direction,
      migrationsTable: 'pgmigrations',
      count,
      log: () => {},
    });
  }

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    await migrate('up', Number.POSITIVE_INFINITY);

    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function freshObservation(): Promise<void> {
    profileId = randomUUID();
    gardenId = randomUUID();
    observationId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    await client.query(
      `INSERT INTO gardens_mapping.garden (id, name, created_by_profile_id) VALUES ($1, 'Backyard', $2)`,
      [gardenId, profileId],
    );
    await client.query(
      `INSERT INTO observations_history.observation
         (id, garden_id, created_by_profile_id, note_text)
       VALUES ($1, $2, $3, 'A note')`,
      [observationId, gardenId, profileId],
    );
  }

  async function insertSymptom(kind: string, severity: string): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO observations_history.observation_symptom
         (id, observation_id, symptom_kind, severity)
       VALUES ($1, $2, $3, $4)`,
      [id, observationId, kind, severity],
    );
    return id;
  }

  it('accepts every documented symptom and every severity', async () => {
    await freshObservation();

    for (const kind of [
      'leaf_spots',
      'leaf_yellowing',
      'leaf_curling',
      'wilting',
      'holes_or_chewing',
      'mould_or_mildew',
      'dieback',
      'stunted_growth',
      'unusual_growth',
    ]) {
      await expect(insertSymptom(kind, 'mild')).resolves.toBeDefined();
    }

    await freshObservation();
    for (const severity of ['mild', 'moderate', 'severe']) {
      await freshObservation();
      await expect(insertSymptom('wilting', severity)).resolves.toBeDefined();
    }
  });

  it('rejects a diagnosis where a visible symptom belongs', async () => {
    await freshObservation();

    // `blight` is a cause, not something a gardener sees; `stress` is a valid
    // `ImageAnalysisKind` and must not be accepted as an observer's word.
    await expect(insertSymptom('blight', 'mild')).rejects.toThrow(/observation_symptom_kind_check/);
    await expect(insertSymptom('stress', 'mild')).rejects.toThrow(/observation_symptom_kind_check/);
  });

  it('rejects a severity outside the three values', async () => {
    await freshObservation();

    await expect(insertSymptom('wilting', 'critical')).rejects.toThrow(
      /observation_symptom_severity_check/,
    );
  });

  it('permits one statement per symptom per observation', async () => {
    await freshObservation();
    await insertSymptom('leaf_spots', 'mild');

    // Seeing the same symptom worse next week is a new observation, the same
    // rule `observation_measurement_unique_kind` states for measurements.
    await expect(insertSymptom('leaf_spots', 'severe')).rejects.toThrow(
      /observation_symptom_unique_kind/,
    );
    await expect(insertSymptom('wilting', 'severe')).resolves.toBeDefined();
  });

  it('requires the observation it belongs to', async () => {
    await freshObservation();
    observationId = randomUUID();

    await expect(insertSymptom('wilting', 'mild')).rejects.toThrow(/observation_id_fkey/);
  });

  it('down reverses up: dropping and reapplying this migration leaves the schema intact', async () => {
    await client.end();

    // Undoes every migration applied after this one, then this one. The
    // depth is derived from the migrations directory, so a migration added
    // on top needs no edit here.
    await migrate('down', rollbackDepthTo('observation-symptoms'));

    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    const dropped = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'observations_history' AND table_name = 'observation_symptom'`,
    );
    expect(dropped.rows).toHaveLength(0);

    await client.end();
    await migrate('up', Number.POSITIVE_INFINITY);
    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    const restored = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'observations_history' AND table_name = 'observation_symptom'`,
    );
    expect(restored.rows).toHaveLength(1);
  });
});
