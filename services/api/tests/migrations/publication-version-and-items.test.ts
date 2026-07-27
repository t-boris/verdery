/**
 * Migration tests for
 * 1786700000000_client-publication-and-work-logs.sql (P9C-DATA-01) — the
 * `publication_version`, `publication_item` and its four detail tables,
 * `publication_staff_attribution`, and `media_entitlement` half of the
 * structural completion evidence. Split out of
 * `client-publication-and-work-logs.test.ts` (which keeps `work_log`/
 * `client_update`, plus the grants and rollback tests that apply to the
 * whole migration) purely to stay under this repository's 600-line source
 * file limit — see that file's own header for the full sibling-file map.
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

const SUITE_NAME = 'publication version and item migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let profileId: string;
  let gardenId: string;
  let engagementId: string;

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
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  async function freshVersion(): Promise<string> {
    const clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    return insertPublicationVersion(client, clientUpdateId, engagementId, gardenId, profileId);
  }

  // --- publication_version -----------------------------------------------

  it('allows at most one publication_version per client_update', async () => {
    const clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    await insertPublicationVersion(client, clientUpdateId, engagementId, gardenId, profileId);
    await expect(
      insertPublicationVersion(client, clientUpdateId, engagementId, gardenId, profileId),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a blank title/summary and a non-positive version_number', async () => {
    const clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    await expect(
      insertPublicationVersion(client, clientUpdateId, engagementId, gardenId, profileId, {
        title: '  ',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_version_title_not_blank_check',
    });
    await expect(
      insertPublicationVersion(client, clientUpdateId, engagementId, gardenId, profileId, {
        version_number: 0,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_version_number_positive_check',
    });
  });

  // --- publication_item and its four detail tables ------------------------

  it('constrains publication_item to the known kind vocabulary', async () => {
    const versionId = await freshVersion();
    await expect(
      insertPublicationItem(client, versionId, gardenId, 'estimate'),
    ).rejects.toMatchObject({ code: '23514', constraint: 'publication_item_kind_check' });
  });

  it('allows at most one garden_snapshot item per publication_version', async () => {
    const versionId = await freshVersion();
    const first = await insertPublicationItem(client, versionId, gardenId, 'garden_snapshot');
    await insertPublicationGardenSnapshotDetail(client, first);

    await expect(
      insertPublicationItem(client, versionId, gardenId, 'garden_snapshot'),
    ).rejects.toMatchObject({ code: '23505', constraint: 'publication_item_garden_snapshot_key' });
  });

  it('rejects a blank description/overview/entry-text on each detail table', async () => {
    const versionId = await freshVersion();

    const workLogItem = await insertPublicationItem(client, versionId, gardenId, 'work_log');
    await expect(
      insertPublicationWorkLogDetail(client, workLogItem, { description: '  ' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_work_log_detail_description_not_blank_check',
    });

    const gardenSnapshotItem = await insertPublicationItem(
      client,
      versionId,
      gardenId,
      'garden_snapshot',
    );
    await expect(
      insertPublicationGardenSnapshotDetail(client, gardenSnapshotItem, { overview_text: '  ' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_garden_snapshot_detail_overview_not_blank_check',
    });

    const timelineItem = await insertPublicationItem(client, versionId, gardenId, 'timeline_entry');
    await expect(
      insertPublicationTimelineEntryDetail(client, timelineItem, { entry_text: '  ' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_timeline_entry_detail_entry_text_not_blank_check',
    });
  });

  it('constrains publication_media_detail to the known media_role vocabulary', async () => {
    const versionId = await freshVersion();
    const mediaId = await insertMediaRecord(client, profileId);
    const mediaItem = await insertPublicationItem(client, versionId, gardenId, 'media');

    await expect(
      insertPublicationMediaDetail(client, mediaItem, mediaId, { media_role: 'duringWork' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_media_detail_media_role_check',
    });

    await insertPublicationMediaDetail(client, mediaItem, mediaId, { media_role: 'before' });
    const { rows } = await client.query<Row>(
      'SELECT media_role FROM collaboration.publication_media_detail WHERE item_id = $1',
      [mediaItem],
    );
    expect(rows[0]).toEqual({ media_role: 'before' });
  });

  it('cascades deleting a publication_item into its own detail row', async () => {
    const versionId = await freshVersion();
    const itemId = await insertPublicationItem(client, versionId, gardenId, 'timeline_entry');
    await insertPublicationTimelineEntryDetail(client, itemId);

    await client.query('DELETE FROM collaboration.publication_item WHERE id = $1', [itemId]);

    const { rows } = await client.query<Row>(
      'SELECT count(*)::int AS remaining FROM collaboration.publication_timeline_entry_detail WHERE item_id = $1',
      [itemId],
    );
    expect(rows[0]).toEqual({ remaining: 0 });
  });

  // --- publication_staff_attribution --------------------------------------

  it('allows one attribution row per (publication_version, staff) pair', async () => {
    const versionId = await freshVersion();
    const staffId = await insertProfile(client);
    await insertPublicationStaffAttribution(client, versionId, staffId);
    await expect(
      insertPublicationStaffAttribution(client, versionId, staffId),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'publication_staff_attribution_version_profile_key',
    });
  });

  it('rejects a blank display_name and a blank (but non-null) role_label', async () => {
    const versionId = await freshVersion();
    const staffId = await insertProfile(client);
    await expect(
      insertPublicationStaffAttribution(client, versionId, staffId, { display_name: '  ' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_staff_attribution_display_name_not_blank_check',
    });
    await expect(
      insertPublicationStaffAttribution(client, versionId, staffId, { role_label: '  ' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'publication_staff_attribution_role_label_not_blank_check',
    });
  });

  // --- media_entitlement ---------------------------------------------------

  it('allows one entitlement per (publication_version, media_record) pair', async () => {
    const versionId = await freshVersion();
    const mediaId = await insertMediaRecord(client, profileId);
    await insertMediaEntitlement(client, engagementId, versionId, mediaId);
    await expect(
      insertMediaEntitlement(client, engagementId, versionId, mediaId),
    ).rejects.toMatchObject({ code: '23505', constraint: 'media_entitlement_version_media_key' });
  });
});
