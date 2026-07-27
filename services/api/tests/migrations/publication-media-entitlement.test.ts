/**
 * Media-entitlement tests for P9C-DATA-01 — one of the four named
 * completion-evidence categories. Proves the schema gives a future
 * authorization check (P9C-MEDIA-01) exactly what collaboration-and-
 * client-sharing.md section 16 asks for: "does this client's engagement
 * have an EXPLICIT entitlement to this exact media object," answerable
 * without re-deriving anything from garden membership, and never true for
 * media nobody ever explicitly entitled.
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
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'client publication media entitlement';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** The exact authorization query section 16 describes — "does this engagement have an explicit entitlement to this media object." */
async function isEntitled(
  client: pg.Client,
  engagementId: string,
  mediaRecordId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM collaboration.media_entitlement
      WHERE engagement_id = $1 AND media_record_id = $2`,
    [engagementId, mediaRecordId],
  );
  return (rows[0]?.count ?? 0) > 0;
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let profileId: string;

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
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('an engagement is entitled only to media explicitly granted through one of its own publications', async () => {
    const gardenId = await insertGarden(client, profileId);
    const engagementId = await insertClientEngagement(client, gardenId, profileId);
    const clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    const versionId = await insertPublicationVersion(
      client,
      clientUpdateId,
      engagementId,
      gardenId,
      profileId,
    );

    const entitledMediaId = await insertMediaRecord(client, profileId);
    const neverEntitledMediaId = await insertMediaRecord(client, profileId);
    await insertMediaEntitlement(client, engagementId, versionId, entitledMediaId);

    expect(await isEntitled(client, engagementId, entitledMediaId)).toBe(true);
    // The second media record was registered but never selected into any
    // publication for this engagement — no row names it, so the
    // authorization query this table exists to serve correctly finds
    // nothing, without needing a NOT-entitled marker of any kind.
    expect(await isEntitled(client, engagementId, neverEntitledMediaId)).toBe(false);
  });

  it('an entitlement granted to one engagement is never visible to another engagement, even for the same media object', async () => {
    const gardenId = await insertGarden(client, profileId);
    const engagementA = await insertClientEngagement(client, gardenId, profileId);
    const engagementB = await insertClientEngagement(client, gardenId, profileId);

    const clientUpdateA = await insertPublishedClientUpdate(
      client,
      engagementA,
      gardenId,
      profileId,
      profileId,
    );
    const versionA = await insertPublicationVersion(
      client,
      clientUpdateA,
      engagementA,
      gardenId,
      profileId,
    );

    const mediaId = await insertMediaRecord(client, profileId);
    await insertMediaEntitlement(client, engagementA, versionA, mediaId);

    expect(await isEntitled(client, engagementA, mediaId)).toBe(true);
    // Engagement B was never granted this media through any publication of
    // its own — cross-engagement isolation, the exact negative test section
    // 22 of the collaboration design asks every resource type to have.
    expect(await isEntitled(client, engagementB, mediaId)).toBe(false);
  });

  it('does not allow two entitlement rows for the same (publication_version, media_record) pair, so re-running a publish step is safe to retry', async () => {
    const gardenId = await insertGarden(client, profileId);
    const engagementId = await insertClientEngagement(client, gardenId, profileId);
    const clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    const versionId = await insertPublicationVersion(
      client,
      clientUpdateId,
      engagementId,
      gardenId,
      profileId,
    );
    const mediaId = await insertMediaRecord(client, profileId);

    await insertMediaEntitlement(client, engagementId, versionId, mediaId);
    await expect(
      insertMediaEntitlement(client, engagementId, versionId, mediaId),
    ).rejects.toMatchObject({ code: '23505', constraint: 'media_entitlement_version_media_key' });

    const { rows } = await client.query<Row>(
      'SELECT count(*)::int AS count FROM collaboration.media_entitlement WHERE publication_version_id = $1',
      [versionId],
    );
    expect(rows[0]).toEqual({ count: 1 });
  });

  it('a publication_media_detail (display) row and a media_entitlement (authorization) row are independent facts about the same media', async () => {
    const gardenId = await insertGarden(client, profileId);
    const engagementId = await insertClientEngagement(client, gardenId, profileId);
    const clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    const versionId = await insertPublicationVersion(
      client,
      clientUpdateId,
      engagementId,
      gardenId,
      profileId,
    );
    const mediaId = await insertMediaRecord(client, profileId);

    // Entitlement can exist with no corresponding display item — e.g. a
    // publisher who grants access ahead of finishing the narrative — and
    // the reverse can equally be exercised without the other. Neither table
    // requires the other to exist; each answers its own question.
    await insertMediaEntitlement(client, engagementId, versionId, mediaId);

    const display = await client.query<Row>(
      'SELECT count(*)::int AS count FROM collaboration.publication_media_detail WHERE media_record_id = $1',
      [mediaId],
    );
    expect(display.rows[0]).toEqual({ count: 0 });
    expect(await isEntitled(client, engagementId, mediaId)).toBe(true);
  });
});
