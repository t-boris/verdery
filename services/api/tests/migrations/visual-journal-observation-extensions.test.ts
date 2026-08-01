/**
 * Migration test for `1787900000000_visual-journal-observation-extensions.sql`:
 * `observation_photo.purpose`, the new `observation_measurement` table, and
 * the `observation.observed_*` phenology/context-snapshot columns — table
 * shape, every reused-vocabulary CHECK constraint, and that `down` genuinely
 * reverses `up`.
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

const SUITE_NAME = 'visual journal observation extensions migration';
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

  async function insertPhoto(purpose: string | null): Promise<string> {
    const mediaId = randomUUID();
    await client.query(
      `INSERT INTO media.media_record
         (id, garden_id, uploaded_by_profile_id, media_class, display_filename,
          declared_content_type, declared_byte_size, bucket_name, object_key, upload_state,
          sensitivity_classification)
       VALUES ($1, $2, $3, 'garden_photo', 'photo.jpg', 'image/jpeg', 100, 'test-user-media', $4,
               'available', 'sensitive')`,
      [mediaId, gardenId, profileId, `ab/${mediaId}/${randomUUID()}`],
    );
    const photoId = randomUUID();
    await client.query(
      `INSERT INTO observations_history.observation_photo (id, observation_id, media_id, purpose)
       VALUES ($1, $2, $3, $4)`,
      [photoId, observationId, mediaId, purpose],
    );
    return photoId;
  }

  describe('observation_photo.purpose', () => {
    it('accepts a null purpose (a pre-existing row) and each documented purpose value', async () => {
      await freshObservation();
      await expect(insertPhoto(null)).resolves.toBeDefined();
      for (const purpose of [
        'whole_plant',
        'leaf_front',
        'leaf_back',
        'stem_or_bark',
        'flower',
        'fruit',
        'symptom_close_up',
        'context_or_free_form',
      ]) {
        await expect(insertPhoto(purpose)).resolves.toBeDefined();
      }
    });

    it('rejects an unrecognized purpose', async () => {
      await freshObservation();
      await expect(insertPhoto('close_up_of_something')).rejects.toThrow(
        /observation_photo_purpose_check/,
      );
    });
  });

  describe('observation_measurement', () => {
    async function insertMeasurement(overrides: {
      kind?: string;
      value?: number;
      unit?: string;
    }): Promise<void> {
      const { kind = 'height', value = 12.5, unit = 'cm' } = overrides;
      await client.query(
        `INSERT INTO observations_history.observation_measurement
           (id, observation_id, kind, value, unit)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), observationId, kind, value, unit],
      );
    }

    it('accepts height, width, and count for the same observation', async () => {
      await freshObservation();
      await expect(
        insertMeasurement({ kind: 'height', value: 30, unit: 'cm' }),
      ).resolves.not.toThrow();
      await expect(
        insertMeasurement({ kind: 'width', value: 15, unit: 'cm' }),
      ).resolves.not.toThrow();
      await expect(
        insertMeasurement({ kind: 'count', value: 3, unit: 'count' }),
      ).resolves.not.toThrow();
    });

    it('rejects an unrecognized kind', async () => {
      await freshObservation();
      await expect(insertMeasurement({ kind: 'circumference' })).rejects.toThrow(
        /observation_measurement_kind_check/,
      );
    });

    it('rejects a negative value', async () => {
      await freshObservation();
      await expect(insertMeasurement({ value: -1 })).rejects.toThrow(
        /observation_measurement_value_check/,
      );
    });

    it('rejects a blank unit', async () => {
      await freshObservation();
      await expect(insertMeasurement({ unit: '' })).rejects.toThrow(
        /observation_measurement_unit_check/,
      );
    });

    it('rejects a second measurement of the same kind for the same observation', async () => {
      await freshObservation();
      await insertMeasurement({ kind: 'height' });
      await expect(insertMeasurement({ kind: 'height' })).rejects.toThrow(
        /observation_measurement_unique_kind/,
      );
    });
  });

  describe('observation phenology and context-snapshot columns', () => {
    async function setSnapshot(overrides: {
      phenologicalStage?: string | null;
      sunExposure?: string | null;
      drainage?: string | null;
      growingContext?: string | null;
    }): Promise<void> {
      await client.query(
        `UPDATE observations_history.observation
            SET observed_phenological_stage = $1,
                observed_sun_exposure = $2,
                observed_drainage = $3,
                observed_growing_context = $4
          WHERE id = $5`,
        [
          overrides.phenologicalStage ?? null,
          overrides.sunExposure ?? null,
          overrides.drainage ?? null,
          overrides.growingContext ?? null,
          observationId,
        ],
      );
    }

    it('accepts every documented value, reusing plant.lifecycle_stage and garden_context_fact vocabularies verbatim', async () => {
      await freshObservation();
      await expect(
        setSnapshot({
          phenologicalStage: 'flowering',
          sunExposure: 'full_sun',
          drainage: 'well_drained',
          growingContext: 'container',
        }),
      ).resolves.not.toThrow();
    });

    it('rejects an unrecognized phenological stage', async () => {
      await freshObservation();
      await expect(setSnapshot({ phenologicalStage: 'dormant' })).rejects.toThrow(
        /observation_phenological_stage_check/,
      );
    });

    it('rejects an unrecognized sun exposure', async () => {
      await freshObservation();
      await expect(setSnapshot({ sunExposure: 'bright_indirect' })).rejects.toThrow(
        /observation_sun_exposure_check/,
      );
    });

    it('rejects an unrecognized drainage value', async () => {
      await freshObservation();
      await expect(setSnapshot({ drainage: 'swampy' })).rejects.toThrow(
        /observation_drainage_check/,
      );
    });

    it('rejects an unrecognized growing context', async () => {
      await freshObservation();
      await expect(setSnapshot({ growingContext: 'raised_bed' })).rejects.toThrow(
        /observation_growing_context_check/,
      );
    });
  });

  it('down reverses up: dropping and reapplying this migration leaves the schema intact', async () => {
    await client.end();

    // `count: 4` undoes 1788200000000_plant-assertion-review-status-index.sql,
    // 1788100000000_client-update-observation-kind.sql, and
    // 1788000000000_health-suggestion-disposition.sql (now the topmost
    // migrations), then this migration itself. Update this count when a
    // later migration is added on top.
    await migrate('down', 4);

    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    const measurementTable = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'observations_history' AND table_name = 'observation_measurement'`,
    );
    expect(measurementTable.rows).toHaveLength(0);

    const purposeColumn = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'observations_history' AND table_name = 'observation_photo'
          AND column_name = 'purpose'`,
    );
    expect(purposeColumn.rows).toHaveLength(0);

    const snapshotColumns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'observations_history' AND table_name = 'observation'
          AND column_name IN
            ('observed_phenological_stage', 'observed_sun_exposure', 'observed_drainage',
             'observed_growing_context')`,
    );
    expect(snapshotColumns.rows).toHaveLength(0);

    const survivingObservationTable = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'observations_history' AND table_name = 'observation'`,
    );
    expect(survivingObservationTable.rows).toHaveLength(1);

    await migrate('up', 2);
  });
});
