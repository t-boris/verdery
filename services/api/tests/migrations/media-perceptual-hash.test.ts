/**
 * Migration test for `1788500000000_media-perceptual-hash.sql`: the column's
 * format rule, that it stays optional, and that `down` reverses `up`.
 *
 * Source: implementation-plan.md work package P11-MEDIA-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { rollbackDepthTo } from '../support/migration-rollback-depth.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'media perceptual hash migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let profileId: string;

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

    profileId = randomUUID();
    await client.query('INSERT INTO identity_access.profile (id, firebase_uid) VALUES ($1, $2)', [
      profileId,
      randomUUID(),
    ]);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function insertMedia(perceptualHash: string | null): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO media.media_record
         (id, uploaded_by_profile_id, media_class, display_filename,
          declared_content_type, declared_byte_size, sensitivity_classification,
          perceptual_hash)
       VALUES ($1, $2, 'garden_photo', 'photo.jpg', 'image/jpeg', 1024, 'standard', $3)`,
      [id, profileId, perceptualHash],
    );
    return id;
  }

  it('accepts sixteen lowercase hex characters', async () => {
    await expect(insertMedia('0f1e2d3c4b5a6978')).resolves.toBeDefined();
  });

  it('stays optional: a record with no hash is still valid', async () => {
    // Every media record predating this column, every non-image class, and
    // every decoder refusal lands here.
    await expect(insertMedia(null)).resolves.toBeDefined();
  });

  it('rejects a hash of the wrong length or alphabet', async () => {
    await expect(insertMedia('0f1e2d3c4b5a69')).rejects.toThrow(
      /media_record_perceptual_hash_format_check/,
    );
    await expect(insertMedia('0F1E2D3C4B5A6978')).rejects.toThrow(
      /media_record_perceptual_hash_format_check/,
    );
  });

  it('answers Hamming distance in SQL, which is the whole point of the format', async () => {
    // The near-duplicate query is a predicate the database evaluates, not a
    // loop in the application over every photo in the garden.
    const { rows } = await client.query<{ distance: number }>(
      `SELECT bit_count(('x' || $1::text)::bit(64) # ('x' || $2::text)::bit(64)) AS distance`,
      ['0000000000000000', '0000000000000003'],
    );

    expect(Number(rows[0]!.distance)).toBe(2);
  });

  it('down reverses up: dropping and reapplying this migration leaves the schema intact', async () => {
    await client.end();

    // Undoes every migration applied after this one, then this one. The
    // depth is derived from the migrations directory, so a migration added
    // on top needs no edit here.
    await migrate('down', rollbackDepthTo('media-perceptual-hash'));

    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    const dropped = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'media' AND table_name = 'media_record'
          AND column_name = 'perceptual_hash'`,
    );
    expect(dropped.rows).toHaveLength(0);

    await client.end();
    await migrate('up', Number.POSITIVE_INFINITY);
    client = new pg.Client({ connectionString: container.getConnectionUri() });
    await client.connect();

    const restored = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'media' AND table_name = 'media_record'
          AND column_name = 'perceptual_hash'`,
    );
    expect(restored.rows).toHaveLength(1);
  });
});
