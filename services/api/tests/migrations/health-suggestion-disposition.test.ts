/**
 * Migration test for `1788000000000_health-suggestion-disposition.sql`:
 * every new `observations_history.image_analysis_result` column and its
 * CHECK constraints (model/prompt version, evidence, alternative
 * explanations, requested view purposes, safety class, disposition and its
 * linkage to `disposition_set_at`/`disposition_set_by_profile_id`), and
 * that `down` genuinely reverses `up`.
 *
 * Source: implementation-plan.md work package P11-HEALTH-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'health suggestion disposition migration';
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
  let photoId: string;

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

  async function freshAnalysisResult(): Promise<string> {
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
    photoId = randomUUID();
    await client.query(
      `INSERT INTO observations_history.observation_photo (id, observation_id, media_id, purpose)
       VALUES ($1, $2, $3, 'whole_plant')`,
      [photoId, observationId, mediaId],
    );

    const analysisId = randomUUID();
    await client.query(
      `INSERT INTO observations_history.image_analysis_result
         (id, observation_photo_id, analysis_kind, suggested_label, confidence_score)
       VALUES ($1, $2, 'stress', 'Wilting leaves', 0.5)`,
      [analysisId, photoId],
    );
    return analysisId;
  }

  it('defaults every new column to its documented value', async () => {
    const id = await freshAnalysisResult();

    const row = await client.query(
      `SELECT model_name, prompt_version, evidence_summary, alternative_explanations,
              requested_view_purposes, safety_class, disposition, disposition_set_at,
              disposition_set_by_profile_id
         FROM observations_history.image_analysis_result WHERE id = $1`,
      [id],
    );

    expect(row.rows[0]).toMatchObject({
      model_name: null,
      prompt_version: null,
      evidence_summary: '',
      alternative_explanations: [],
      requested_view_purposes: [],
      safety_class: 'informational',
      disposition: 'unresolved',
      disposition_set_at: null,
      disposition_set_by_profile_id: null,
    });
  });

  it('accepts a fully populated row', async () => {
    const id = await freshAnalysisResult();

    await expect(
      client.query(
        `UPDATE observations_history.image_analysis_result
            SET model_name = 'gemini-test', prompt_version = 2,
                evidence_summary = 'Yellowing on lower leaves.',
                alternative_explanations = $2::jsonb,
                requested_view_purposes = $3::jsonb,
                safety_class = 'monitor',
                disposition = 'accepted_as_observation',
                disposition_set_at = now(),
                disposition_set_by_profile_id = $4
          WHERE id = $1`,
        [
          id,
          JSON.stringify(['Nutrient deficiency', 'Overwatering']),
          JSON.stringify(['leaf_back', 'symptom_close_up']),
          profileId,
        ],
      ),
    ).resolves.toBeDefined();
  });

  describe('model_name / prompt_version', () => {
    it('rejects a blank model_name', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result SET model_name = '' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_model_name_check/);
    });

    it('rejects a prompt_version below 1', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result SET prompt_version = 0 WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_prompt_version_check/);
    });
  });

  describe('alternative_explanations / requested_view_purposes', () => {
    it('rejects a non-array alternative_explanations', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result
              SET alternative_explanations = '{"not": "an array"}'::jsonb WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_alternative_explanations_check/);
    });

    it('rejects a non-array requested_view_purposes', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result
              SET requested_view_purposes = '"flower"'::jsonb WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_requested_view_purposes_check/);
    });

    it('rejects a requested_view_purposes entry outside the P11-MEDIA-01 purpose vocabulary', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result
              SET requested_view_purposes = '["close_up_of_something"]'::jsonb WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_requested_view_purposes_check/);
    });

    it('accepts every documented purpose value in requested_view_purposes', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result
              SET requested_view_purposes = $2::jsonb WHERE id = $1`,
          [
            id,
            JSON.stringify([
              'whole_plant',
              'leaf_front',
              'leaf_back',
              'stem_or_bark',
              'flower',
              'fruit',
              'symptom_close_up',
              'context_or_free_form',
            ]),
          ],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('safety_class', () => {
    it('rejects an unrecognized safety class', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result SET safety_class = 'urgent' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_safety_class_check/);
    });
  });

  describe('disposition and its linkage to disposition_set_at/disposition_set_by_profile_id', () => {
    it('rejects an unrecognized disposition', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result SET disposition = 'ignored' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_disposition_check/);
    });

    it('rejects setting disposition_set_at while disposition stays unresolved', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result SET disposition_set_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_disposition_set_at_linkage_check/);
    });

    it('rejects a non-unresolved disposition with no disposition_set_at', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result
              SET disposition = 'rejected', disposition_set_by_profile_id = $2 WHERE id = $1`,
          [id, profileId],
        ),
      ).rejects.toThrow(/image_analysis_result_disposition_set_at_linkage_check/);
    });

    it('rejects a non-unresolved disposition with no disposition_set_by_profile_id', async () => {
      const id = await freshAnalysisResult();
      await expect(
        client.query(
          `UPDATE observations_history.image_analysis_result
              SET disposition = 'rejected', disposition_set_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/image_analysis_result_disposition_set_by_linkage_check/);
    });

    it('accepts confirmed_externally/accepted_as_observation/rejected, each with both linkage fields set', async () => {
      for (const disposition of ['confirmed_externally', 'accepted_as_observation', 'rejected']) {
        const id = await freshAnalysisResult();
        await expect(
          client.query(
            `UPDATE observations_history.image_analysis_result
                SET disposition = $2, disposition_set_at = now(), disposition_set_by_profile_id = $3
              WHERE id = $1`,
            [id, disposition, profileId],
          ),
        ).resolves.toBeDefined();
      }
    });
  });

  it('down reverses up: dropping and reapplying this migration leaves the schema intact', async () => {
    await client.end();

    await migrate('down', 2);

    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    const droppedColumns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'observations_history' AND table_name = 'image_analysis_result'
          AND column_name IN
            ('model_name', 'prompt_version', 'evidence_summary', 'alternative_explanations',
             'requested_view_purposes', 'safety_class', 'disposition', 'disposition_set_at',
             'disposition_set_by_profile_id')`,
    );
    expect(droppedColumns.rows).toHaveLength(0);

    const survivingTable = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'observations_history' AND table_name = 'image_analysis_result'`,
    );
    expect(survivingTable.rows).toHaveLength(1);

    await migrate('up', 1);
  });
});
