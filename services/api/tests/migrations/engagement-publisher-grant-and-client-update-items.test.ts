/**
 * Migration tests for
 * 1786800000000_engagement-publisher-grant-and-client-update-items.sql
 * (P9C-PUBLISH-01) — every CHECK and uniqueness constraint on
 * `collaboration.publisher_grant` and `collaboration.client_update_item`,
 * the ordinary (non-REVOKEd) privilege posture both tables hold, and
 * rollback.
 *
 * Sibling to `client-publication-and-work-logs.test.ts` (the P9C-DATA-01
 * migration this one builds directly on top of).
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile } from '../support/collaboration-fixtures.js';
import type { Row } from '../support/collaboration-fixtures.js';
import { insertClientEngagement } from '../support/service-organization-fixtures.js';
import {
  insertClientUpdate,
  insertMediaRecord,
  insertWorkLog,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'engagement publisher grant and client-update items migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

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

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NEW_TABLES = ['publisher_grant', 'client_update_item'];

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;
  let secondProfileId: string;
  let gardenId: string;
  let engagementId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    profileId = await insertProfile(client);
    secondProfileId = await insertProfile(client);
    gardenId = await insertGarden(client, profileId);
    engagementId = await insertClientEngagement(client, gardenId, profileId);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  // --- publisher_grant -------------------------------------------------------

  it('rejects an unrecognized publisher_grant.state', async () => {
    await expect(
      client.query(
        `INSERT INTO collaboration.publisher_grant
           (id, engagement_id, profile_id, state, granted_by_profile_id)
         VALUES (gen_random_uuid(), $1, $2, 'pending', $2)`,
        [engagementId, profileId],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'publisher_grant_state_check' });
  });

  it('rejects a revoked grant with no revoked_at', async () => {
    await expect(
      client.query(
        `INSERT INTO collaboration.publisher_grant
           (id, engagement_id, profile_id, state, granted_by_profile_id)
         VALUES (gen_random_uuid(), $1, $2, 'revoked', $2)`,
        [engagementId, profileId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publisher_grant_revoked_linkage_check',
    });
  });

  it('rejects an active grant that already names a revoked_by_profile_id', async () => {
    await expect(
      client.query(
        `INSERT INTO collaboration.publisher_grant
           (id, engagement_id, profile_id, state, granted_by_profile_id, revoked_by_profile_id)
         VALUES (gen_random_uuid(), $1, $2, 'active', $2, $2)`,
        [engagementId, profileId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publisher_grant_revoked_by_linkage_check',
    });
  });

  it('allows exactly one ACTIVE grant per (engagement, profile), rejecting a second', async () => {
    await client.query(
      `INSERT INTO collaboration.publisher_grant
         (id, engagement_id, profile_id, state, granted_by_profile_id)
       VALUES (gen_random_uuid(), $1, $2, 'active', $2)`,
      [engagementId, secondProfileId],
    );

    await expect(
      client.query(
        `INSERT INTO collaboration.publisher_grant
           (id, engagement_id, profile_id, state, granted_by_profile_id)
         VALUES (gen_random_uuid(), $1, $2, 'active', $2)`,
        [engagementId, secondProfileId],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'publisher_grant_active_key' });
  });

  // --- client_update_item ----------------------------------------------------

  it('rejects an unrecognized client_update_item.kind', async () => {
    const clientUpdateId = await insertClientUpdate(client, engagementId, gardenId, profileId);

    await expect(
      client.query(
        `INSERT INTO collaboration.client_update_item
           (id, client_update_id, kind, occurred_at)
         VALUES (gen_random_uuid(), $1, 'garden_snapshot', now())`,
        [clientUpdateId],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_item_kind_check' });
  });

  it('rejects a work_log item missing its source_work_log_id/description', async () => {
    const clientUpdateId = await insertClientUpdate(client, engagementId, gardenId, profileId);

    await expect(
      client.query(
        `INSERT INTO collaboration.client_update_item
           (id, client_update_id, kind, occurred_at)
         VALUES (gen_random_uuid(), $1, 'work_log', now())`,
        [clientUpdateId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_update_item_work_log_shape_check',
    });
  });

  it('rejects a media item missing its media_record_id/media_role', async () => {
    const clientUpdateId = await insertClientUpdate(client, engagementId, gardenId, profileId);

    await expect(
      client.query(
        `INSERT INTO collaboration.client_update_item
           (id, client_update_id, kind, occurred_at)
         VALUES (gen_random_uuid(), $1, 'media', now())`,
        [clientUpdateId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_update_item_media_shape_check',
    });
  });

  it('rejects a blank caption on a media item', async () => {
    const clientUpdateId = await insertClientUpdate(client, engagementId, gardenId, profileId);
    const mediaRecordId = await insertMediaRecord(client, profileId);

    await expect(
      client.query(
        `INSERT INTO collaboration.client_update_item
           (id, client_update_id, kind, occurred_at, media_record_id, media_role, caption)
         VALUES (gen_random_uuid(), $1, 'media', now(), $2, 'after', '   ')`,
        [clientUpdateId, mediaRecordId],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_update_item_caption_not_blank_check',
    });
  });

  it('allows a valid work_log item, and rejects staging the SAME source_work_log_id twice on one draft', async () => {
    const clientUpdateId = await insertClientUpdate(client, engagementId, gardenId, profileId);
    const workLogId = await insertWorkLog(client, gardenId, profileId);

    await client.query(
      `INSERT INTO collaboration.client_update_item
         (id, client_update_id, kind, occurred_at, source_work_log_id, description)
       VALUES (gen_random_uuid(), $1, 'work_log', now(), $2, 'Pruned the roses')`,
      [clientUpdateId, workLogId],
    );

    await expect(
      client.query(
        `INSERT INTO collaboration.client_update_item
           (id, client_update_id, kind, occurred_at, source_work_log_id, description)
         VALUES (gen_random_uuid(), $1, 'work_log', now(), $2, 'Pruned the roses again')`,
        [clientUpdateId, workLogId],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'client_update_item_work_log_key' });
  });

  it('allows a valid media item, and rejects staging the SAME media_record_id twice on one draft', async () => {
    const clientUpdateId = await insertClientUpdate(client, engagementId, gardenId, profileId);
    const mediaRecordId = await insertMediaRecord(client, profileId);

    await client.query(
      `INSERT INTO collaboration.client_update_item
         (id, client_update_id, kind, occurred_at, media_record_id, media_role)
       VALUES (gen_random_uuid(), $1, 'media', now(), $2, 'after')`,
      [clientUpdateId, mediaRecordId],
    );

    await expect(
      client.query(
        `INSERT INTO collaboration.client_update_item
           (id, client_update_id, kind, occurred_at, media_record_id, media_role)
         VALUES (gen_random_uuid(), $1, 'media', now(), $2, 'before')`,
        [clientUpdateId, mediaRecordId],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'client_update_item_media_key' });
  });

  it('cascades: deleting a client_update removes its staged items', async () => {
    const clientUpdateId = await insertClientUpdate(client, engagementId, gardenId, profileId);
    const workLogId = await insertWorkLog(client, gardenId, profileId);
    await client.query(
      `INSERT INTO collaboration.client_update_item
         (id, client_update_id, kind, occurred_at, source_work_log_id, description)
       VALUES (gen_random_uuid(), $1, 'work_log', now(), $2, 'Pruned the roses')`,
      [clientUpdateId, workLogId],
    );

    await client.query('DELETE FROM collaboration.client_update WHERE id = $1', [clientUpdateId]);

    const { rows } = await client.query<Row>(
      'SELECT id FROM collaboration.client_update_item WHERE client_update_id = $1',
      [clientUpdateId],
    );
    expect(rows).toHaveLength(0);
  });

  // --- Privileges and rollback ------------------------------------------------

  it('gives both new tables ordinary default grants — nothing REVOKEd, unlike the eight P9C-DATA-01 immutable tables', async () => {
    const { rows } = await client.query<Row>(
      `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'collaboration'
          AND table_name = ANY($1)`,
      [NEW_TABLES],
    );

    const grantedFor = (table: string): Set<string> =>
      new Set(
        rows
          .filter((row) => row['table_name'] === table && row['grantee'] === 'verdery_application')
          .map((row) => row['privilege_type'] as string),
      );

    for (const table of NEW_TABLES) {
      expect(grantedFor(table)).toEqual(new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']));
    }
    expect(rows.some((row) => row['grantee'] === 'PUBLIC')).toBe(false);
  });

  it('rolls back cleanly, leaving no trace of either new table', async () => {
    // `count: 13` undoes every newer migration (through
    // 1787800000000_plant-search-extensions.sql, nothing this
    // file's own assertions below check) first, then this migration itself.
    // Update this count when a later migration is added on top, the same
    // convention every earlier migration test here already follows.
    await migrate(databaseUrl, 'down', 13);

    const { rows } = await client.query<Row>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'collaboration' AND table_name = ANY($1)`,
      [NEW_TABLES],
    );
    expect(rows).toEqual([]);

    // Re-applying must succeed cleanly — there is no backfill here to
    // re-exercise, since both tables start empty.
    await migrate(databaseUrl, 'up');
    const reapplied = await client.query<Row>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'collaboration' AND table_name = ANY($1)`,
      [NEW_TABLES],
    );
    expect(reapplied.rows.map((row) => row['table_name']).sort()).toEqual([...NEW_TABLES].sort());
  });
});
