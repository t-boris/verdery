/**
 * Migration tests for the durable media-processing job table (P6-ASYNC-01):
 * every column and CHECK constraint on `media.processing_job`, the new
 * `verdery_worker` role's narrow grants, and the down migration's cleanup.
 *
 * Source: implementation-plan.md work package P6-ASYNC-01;
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

const SUITE_NAME = 'media processing jobs migration';

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
  let mediaId: string;

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

  async function freshMediaRecord(): Promise<void> {
    profileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
    mediaId = await insertRow(
      'media.media_record',
      withId({
        uploaded_by_profile_id: profileId,
        media_class: 'garden_photo',
        display_filename: 'photo.jpg',
        declared_content_type: 'image/jpeg',
        declared_byte_size: 123_456,
        sensitivity_classification: 'standard',
      }),
    );
  }

  const insertJob = (overrides: Row = {}) =>
    insertRow('media.processing_job', withId({ media_id: mediaId, ...overrides }));

  it('creates media.processing_job with the documented default shape', async () => {
    await freshMediaRecord();
    const jobId = await insertJob();

    const row = await client.query<{
      job_kind: string;
      processor_config_version: string;
      state: string;
      attempt: number;
      input_checksums: unknown;
      output_objects: unknown;
      outcome_code: string | null;
      revision: number;
    }>(
      `SELECT job_kind, processor_config_version, state, attempt, input_checksums,
              output_objects, outcome_code, revision
         FROM media.processing_job WHERE id = $1`,
      [jobId],
    );

    expect(row.rows[0]).toEqual({
      job_kind: 'derivative_generation',
      processor_config_version: 'v1',
      state: 'requested',
      attempt: 1,
      input_checksums: [],
      output_objects: null,
      outcome_code: null,
      revision: 1,
    });
  });

  it('rejects an unrecognized state, a non-positive attempt, and a blank job_kind', async () => {
    await freshMediaRecord();

    await expect(insertJob({ state: 'bogus' })).rejects.toThrow(/media_processing_job_state_check/);
    await expect(insertJob({ attempt: 0 })).rejects.toThrow(
      /media_processing_job_attempt_positive_check/,
    );
    await expect(insertJob({ job_kind: '' })).rejects.toThrow(
      /media_processing_job_job_kind_check/,
    );
  });

  it('requires an outcome_code exactly when the state is terminal', async () => {
    await freshMediaRecord();

    await expect(insertJob({ state: 'succeeded' })).rejects.toThrow(
      /media_processing_job_outcome_requires_terminal_check/,
    );
    await expect(insertJob({ state: 'requested', outcome_code: 'ok' })).rejects.toThrow(
      /media_processing_job_outcome_requires_terminal_check/,
    );

    const terminalId = await insertJob({ state: 'succeeded', outcome_code: 'ok' });
    const row = await client.query<{ state: string }>(
      'SELECT state FROM media.processing_job WHERE id = $1',
      [terminalId],
    );
    expect(row.rows[0]?.state).toBe('succeeded');
  });

  it('rejects a job for a media id that does not exist', async () => {
    await freshMediaRecord();

    await expect(insertJob({ media_id: randomUUID() })).rejects.toThrow(
      /processing_job_media_id_fkey/,
    );
  });

  it('grants verdery_application full CRUD via the platform default-privilege loop, unprompted', async () => {
    const result = await client.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
    }>(
      `SELECT
         has_table_privilege('verdery_application', 'media.processing_job', 'SELECT') AS can_select,
         has_table_privilege('verdery_application', 'media.processing_job', 'INSERT') AS can_insert,
         has_table_privilege('verdery_application', 'media.processing_job', 'UPDATE') AS can_update`,
    );
    expect(result.rows[0]).toEqual({ can_select: true, can_insert: true, can_update: true });
  });

  it('grants verdery_worker exactly SELECT/UPDATE on outbox_event and SELECT/INSERT/UPDATE on processing_job, nothing on media_record', async () => {
    const result = await client.query<{
      outbox_select: boolean;
      outbox_update: boolean;
      outbox_delete: boolean;
      job_select: boolean;
      job_insert: boolean;
      job_update: boolean;
      job_delete: boolean;
      media_record_select: boolean;
    }>(
      `SELECT
         has_table_privilege('verdery_worker', 'platform.outbox_event', 'SELECT') AS outbox_select,
         has_table_privilege('verdery_worker', 'platform.outbox_event', 'UPDATE') AS outbox_update,
         has_table_privilege('verdery_worker', 'platform.outbox_event', 'DELETE') AS outbox_delete,
         has_table_privilege('verdery_worker', 'media.processing_job', 'SELECT') AS job_select,
         has_table_privilege('verdery_worker', 'media.processing_job', 'INSERT') AS job_insert,
         has_table_privilege('verdery_worker', 'media.processing_job', 'UPDATE') AS job_update,
         has_table_privilege('verdery_worker', 'media.processing_job', 'DELETE') AS job_delete,
         has_table_privilege('verdery_worker', 'media.media_record', 'SELECT') AS media_record_select`,
    );

    expect(result.rows[0]).toEqual({
      outbox_select: true,
      outbox_update: true,
      outbox_delete: false,
      job_select: true,
      job_insert: true,
      job_update: true,
      job_delete: false,
      media_record_select: false,
    });
  });

  it('rolls back, dropping media.processing_job and the verdery_worker role', async () => {
    await freshMediaRecord();
    await insertJob();

    await client.end();

    await migrate(databaseUrl, 'down', 1);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const table = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'media' AND table_name = 'processing_job'`,
    );
    expect(table.rows).toHaveLength(0);

    const role = await client.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname = 'verdery_worker'`,
    );
    expect(role.rows).toHaveLength(0);

    // media.media_record itself is untouched by this migration's rollback.
    const mediaRecordTable = await client.query<{ qualified: string }>(
      `SELECT table_schema || '.' || table_name AS qualified
         FROM information_schema.tables
        WHERE table_schema = 'media' AND table_name = 'media_record'`,
    );
    expect(mediaRecordTable.rows).toHaveLength(1);
  });
});
