/**
 * Immutability tests for P9C-DATA-01 — one of the four named completion-
 * evidence categories ("Immutability, snapshot, media-entitlement, and
 * withdrawal tests"). Proves, against real PostgreSQL, that the eight
 * REVOKE-enforced tables `1786700000000_client-publication-and-work-logs
 * .sql` creates genuinely cannot be mutated by the running service —
 * not merely that the metadata SAYS so (`client-publication-and-work-logs
 * .test.ts`'s own grants test already checks `information_schema
 * .role_table_grants`), but that an actual write attempt through
 * `verdery_application`'s own privileges is rejected by PostgreSQL itself.
 *
 * Mechanism: `SET ROLE verdery_application` on the same connection. A
 * superuser (the Testcontainers connection every migration test in this
 * suite uses) may `SET ROLE` to any role without needing prior membership,
 * and once set, ordinary privilege checks apply for the remainder of that
 * role context — this is what lets a single connection prove both "the
 * grant is absent" and "the absence is actually enforced" without standing
 * up a second, separately-authenticated connection the way
 * `platform-baseline.test.ts`'s own least-privilege test does for a
 * different, narrower concern (schema-level CREATE, not row-level UPDATE).
 *
 * `work_log` and `client_update` are deliberately NOT tested here: neither
 * carries a REVOKE (see the migration's own header, "WHY TEN TABLES, NOT
 * FEWER" and "WHAT THIS BUYS OVER `task_revision`'s OWN PRECEDENT") — their
 * immutability (`work_log`) or intentional mutability (`client_update`) is
 * a separate, already-covered story.
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile } from '../support/collaboration-fixtures.js';
import { insertClientEngagement } from '../support/service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertMediaRecord,
  insertPublicationGardenSnapshotDetail,
  insertPublicationItem,
  insertPublicationMediaDetail,
  insertPublicationStaffAttribution,
  insertPublicationTimelineEntryDetail,
  insertPublicationVersion,
  insertPublicationWorkLogDetail,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'client publication immutability';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const INSUFFICIENT_PRIVILEGE = '42501';

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let profileId: string;
  let gardenId: string;
  let engagementId: string;
  let clientUpdateId: string;
  let versionId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    const databaseUrl = container.getConnectionUri();
    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    profileId = await insertProfile(client);
    gardenId = await insertGarden(client, profileId);
    engagementId = await insertClientEngagement(client, gardenId, profileId);
    clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    versionId = await insertPublicationVersion(
      client,
      clientUpdateId,
      engagementId,
      gardenId,
      profileId,
    );
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function asApplicationRole<T>(run: () => Promise<T>): Promise<T> {
    await client.query('SET ROLE verdery_application');
    try {
      return await run();
    } finally {
      await client.query('RESET ROLE');
    }
  }

  it('rejects UPDATE and DELETE on publication_version through verdery_application', async () => {
    await expect(
      asApplicationRole(() =>
        client.query('UPDATE collaboration.publication_version SET title = $1 WHERE id = $2', [
          'Rewritten after the fact',
          versionId,
        ]),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    await expect(
      asApplicationRole(() =>
        client.query('DELETE FROM collaboration.publication_version WHERE id = $1', [versionId]),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('rejects UPDATE and DELETE on publication_item', async () => {
    const itemId = await insertPublicationItem(client, versionId, gardenId, 'timeline_entry');
    await insertPublicationTimelineEntryDetail(client, itemId);

    await expect(
      asApplicationRole(() =>
        client.query('UPDATE collaboration.publication_item SET kind = $1 WHERE id = $2', [
          'media',
          itemId,
        ]),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    await expect(
      asApplicationRole(() =>
        client.query('DELETE FROM collaboration.publication_item WHERE id = $1', [itemId]),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('rejects UPDATE on every one of the four publication_item detail tables', async () => {
    const workLogItem = await insertPublicationItem(client, versionId, gardenId, 'work_log');
    await insertPublicationWorkLogDetail(client, workLogItem);
    await expect(
      asApplicationRole(() =>
        client.query(
          'UPDATE collaboration.publication_work_log_detail SET description = $1 WHERE item_id = $2',
          ['Rewritten', workLogItem],
        ),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    const mediaItem = await insertPublicationItem(client, versionId, gardenId, 'media');
    const mediaRecordId = await insertMediaRecord(client, profileId);
    await insertPublicationMediaDetail(client, mediaItem, mediaRecordId);
    await expect(
      asApplicationRole(() =>
        client.query(
          "UPDATE collaboration.publication_media_detail SET media_role = 'before' WHERE item_id = $1",
          [mediaItem],
        ),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    const gardenSnapshotItem = await insertPublicationItem(
      client,
      versionId,
      gardenId,
      'garden_snapshot',
    );
    await insertPublicationGardenSnapshotDetail(client, gardenSnapshotItem);
    await expect(
      asApplicationRole(() =>
        client.query(
          'UPDATE collaboration.publication_garden_snapshot_detail SET overview_text = $1 WHERE item_id = $2',
          ['Rewritten', gardenSnapshotItem],
        ),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    const timelineItem = await insertPublicationItem(client, versionId, gardenId, 'timeline_entry');
    await insertPublicationTimelineEntryDetail(client, timelineItem);
    await expect(
      asApplicationRole(() =>
        client.query(
          'UPDATE collaboration.publication_timeline_entry_detail SET entry_text = $1 WHERE item_id = $2',
          ['Rewritten', timelineItem],
        ),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('rejects UPDATE on publication_staff_attribution', async () => {
    const staffId = await insertProfile(client);
    await insertPublicationStaffAttribution(client, versionId, staffId);

    await expect(
      asApplicationRole(() =>
        client.query(
          'UPDATE collaboration.publication_staff_attribution SET display_name = $1 WHERE publication_version_id = $2 AND staff_profile_id = $3',
          ['Someone else entirely', versionId, staffId],
        ),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('rejects UPDATE and DELETE on media_entitlement', async () => {
    const mediaRecordId = await insertMediaRecord(client, profileId);
    await insertMediaEntitlement(client, engagementId, versionId, mediaRecordId);

    await expect(
      asApplicationRole(() =>
        client.query(
          'UPDATE collaboration.media_entitlement SET media_record_id = $1 WHERE publication_version_id = $2',
          [mediaRecordId, versionId],
        ),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });

    await expect(
      asApplicationRole(() =>
        client.query(
          'DELETE FROM collaboration.media_entitlement WHERE publication_version_id = $1',
          [versionId],
        ),
      ),
    ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
  });

  it('still allows verdery_application to SELECT and INSERT on the immutable tables', async () => {
    const mediaRecordId = await insertMediaRecord(client, profileId);

    await asApplicationRole(async () => {
      await client.query(
        `INSERT INTO collaboration.media_entitlement
           (id, engagement_id, publication_version_id, media_record_id)
         VALUES (gen_random_uuid(), $1, $2, $3)`,
        [engagementId, versionId, mediaRecordId],
      );
      const { rows } = await client.query(
        'SELECT count(*)::int AS count FROM collaboration.media_entitlement',
      );
      expect((rows[0] as { count: number }).count).toBeGreaterThan(0);
    });
  });
});
