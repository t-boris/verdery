/**
 * Withdrawal tests for P9C-DATA-01 — one of the four named completion-
 * evidence categories. Proves collaboration-and-client-sharing.md section
 * 10's own withdrawal sentence directly against real PostgreSQL:
 * "Withdrawal removes a publication from ordinary client queries and
 * revokes its media entitlements. It does not erase the publication
 * identity or security audit trail."
 *
 * Withdrawal never writes to `media_entitlement` (see the migration's own
 * header, "WITHDRAWAL NEVER TOUCHES `media_entitlement`") — the ordinary
 * client/media authorization QUERY joins to `client_update.state`, and it
 * is that join, not a second write, that this suite proves stops matching
 * once a `client_update` transitions to `'withdrawn'`.
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

const SUITE_NAME = 'client publication withdrawal';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** The exact "ordinary client query" shape P9C-API-01/P9C-MEDIA-01 will run: a publication is visible only through a `client_update` currently in `'published'`. */
async function visiblePublicationIds(client: pg.Client, engagementId: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT pv.id FROM collaboration.publication_version pv
       JOIN collaboration.client_update cu ON cu.id = pv.client_update_id
      WHERE cu.engagement_id = $1 AND cu.state = 'published'
      ORDER BY pv.id`,
    [engagementId],
  );
  return rows.map((row) => row.id);
}

/** The mirror authorization check: media is reachable only through a visible (published, not withdrawn) publication. */
async function authorizedMedia(
  client: pg.Client,
  engagementId: string,
  mediaRecordId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM collaboration.media_entitlement me
       JOIN collaboration.publication_version pv ON pv.id = me.publication_version_id
       JOIN collaboration.client_update cu ON cu.id = pv.client_update_id
      WHERE me.engagement_id = $1 AND me.media_record_id = $2 AND cu.state = 'published'`,
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

  it('removes a publication from the ordinary client query once withdrawn, while its own row survives untouched', async () => {
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

    expect(await visiblePublicationIds(client, engagementId)).toEqual([versionId]);

    // Withdrawal as this schema models it: a state transition on the
    // MUTABLE `client_update` row, with its own timestamp and actor — never
    // a delete, and never a write against `publication_version` itself
    // (which cannot be UPDATEd at all; see `publication-immutability
    // .test.ts`).
    await client.query(
      `UPDATE collaboration.client_update
          SET state = 'withdrawn', withdrawn_at = $2, withdrawn_by_profile_id = $3,
              withdrawn_reason = 'client requested removal'
        WHERE id = $1`,
      [clientUpdateId, new Date('2026-06-05T09:00:00Z'), profileId],
    );

    // Gone from ordinary client query scope.
    expect(await visiblePublicationIds(client, engagementId)).toEqual([]);

    // But the publication's own identity is untouched — not erased, not
    // renamed, not reassigned.
    const { rows: versionRows } = await client.query<Row>(
      'SELECT id, title, summary, published_at FROM collaboration.publication_version WHERE id = $1',
      [versionId],
    );
    expect(versionRows[0]).toMatchObject({ id: versionId, title: 'June visit summary' });

    // And the client_update row itself still carries its own withdrawal
    // record — the security/audit trail this section explicitly protects.
    const { rows: updateRows } = await client.query<Row>(
      'SELECT state, withdrawn_reason, withdrawn_by_profile_id FROM collaboration.client_update WHERE id = $1',
      [clientUpdateId],
    );
    expect(updateRows[0]).toEqual({
      state: 'withdrawn',
      withdrawn_reason: 'client requested removal',
      withdrawn_by_profile_id: profileId,
    });
  });

  it('revokes media access on withdrawal without writing to media_entitlement at all', async () => {
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

    expect(await authorizedMedia(client, engagementId, mediaId)).toBe(true);

    await client.query(
      `UPDATE collaboration.client_update
          SET state = 'withdrawn', withdrawn_at = $2, withdrawn_by_profile_id = $3
        WHERE id = $1`,
      [clientUpdateId, new Date('2026-06-05T09:00:00Z'), profileId],
    );

    // Authorization now fails — media access is revoked.
    expect(await authorizedMedia(client, engagementId, mediaId)).toBe(false);

    // The entitlement row itself is untouched: still exactly one row,
    // proving revocation happened entirely through the join above, not
    // through a write against this table (which cannot be written to by
    // `verdery_application` in the first place — see
    // `publication-immutability.test.ts`).
    const { rows } = await client.query<Row>(
      'SELECT count(*)::int AS count FROM collaboration.media_entitlement WHERE publication_version_id = $1',
      [versionId],
    );
    expect(rows[0]).toEqual({ count: 1 });
  });

  it('withdrawing one engagement publication leaves a sibling engagement publication for the same garden unaffected', async () => {
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
    const clientUpdateB = await insertPublishedClientUpdate(
      client,
      engagementB,
      gardenId,
      profileId,
      profileId,
    );
    const versionB = await insertPublicationVersion(
      client,
      clientUpdateB,
      engagementB,
      gardenId,
      profileId,
    );

    await client.query(
      `UPDATE collaboration.client_update
          SET state = 'withdrawn', withdrawn_at = $2, withdrawn_by_profile_id = $3
        WHERE id = $1`,
      [clientUpdateA, new Date('2026-06-05T09:00:00Z'), profileId],
    );

    expect(await visiblePublicationIds(client, engagementA)).toEqual([]);
    expect(await visiblePublicationIds(client, engagementB)).toEqual([versionB]);
    // `versionA` is unaffected in identity even though invisible via the
    // ordinary query.
    const { rows } = await client.query<Row>(
      'SELECT id FROM collaboration.publication_version WHERE id = $1',
      [versionA],
    );
    expect(rows).toHaveLength(1);
  });
});
