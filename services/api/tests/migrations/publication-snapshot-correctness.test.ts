/**
 * Snapshot-correctness tests for P9C-DATA-01 — one of the four named
 * completion-evidence categories. Proves, against real PostgreSQL, the
 * property collaboration-and-client-sharing.md section 11 states in prose
 * ("Snapshots preserve what the client saw at publication time. A later
 * operational edit cannot silently rewrite an older publication"): once a
 * `publication_work_log_detail` (or `publication_version`) row exists, a
 * subsequent write to the internal source the snapshot was copied FROM
 * leaves the already-published snapshot's own text completely unchanged,
 * because nothing about the snapshot is a live read of that source.
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
  insertPublicationItem,
  insertPublicationVersion,
  insertPublicationWorkLogDetail,
  insertPublishedClientUpdate,
  insertWorkLog,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'client publication snapshot correctness';
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

  it('a later edit to the source work_log does not retroactively change an already-published snapshot', async () => {
    const workLogId = await insertWorkLog(client, gardenId, profileId, {
      description: 'Pruned the apple tree and removed deadwood',
    });

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
    const itemId = await insertPublicationItem(client, versionId, gardenId, 'work_log');
    await insertPublicationWorkLogDetail(client, itemId, {
      description: 'Pruned the apple tree and removed deadwood',
      source_work_log_id: workLogId,
    });

    // A later operational correction to the internal fact — the exact
    // scenario section 11 names. `work_log` carries ordinary default
    // grants (see the migration's own header on why it is NOT among the
    // REVOKE-enforced tables), so this UPDATE succeeds at the database
    // layer; the point of this test is what happens to the SNAPSHOT, not
    // whether this write itself is possible.
    await client.query('UPDATE collaboration.work_log SET description = $2 WHERE id = $1', [
      workLogId,
      'Actually there was significant fire-blight damage requiring removal',
    ]);

    const { rows: sourceRows } = await client.query<Row>(
      'SELECT description FROM collaboration.work_log WHERE id = $1',
      [workLogId],
    );
    expect(sourceRows[0]).toEqual({
      description: 'Actually there was significant fire-blight damage requiring removal',
    });

    // The published snapshot is untouched — a live join to `work_log` would
    // have shown the corrected text; the stored copy does not.
    const { rows: snapshotRows } = await client.query<Row>(
      'SELECT description, source_work_log_id FROM collaboration.publication_work_log_detail WHERE item_id = $1',
      [itemId],
    );
    expect(snapshotRows[0]).toEqual({
      description: 'Pruned the apple tree and removed deadwood',
      source_work_log_id: workLogId,
    });
  });

  it('a later edit to a client_update draft field does not alter a publication_version already snapshotted from an earlier revision', async () => {
    const clientUpdateId = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
      { title: 'June visit summary', summary: 'Cleared the north bed.' },
    );
    const versionId = await insertPublicationVersion(
      client,
      clientUpdateId,
      engagementId,
      gardenId,
      profileId,
      { title: 'June visit summary', summary: 'Cleared the north bed.' },
    );

    // `client_update` remains mutable (no REVOKE) — a draft can genuinely be
    // edited after it was published, e.g. to prepare notes for a future
    // update. What matters is that doing so leaves the FROZEN version alone.
    await client.query(
      'UPDATE collaboration.client_update SET title = $2, revision = revision + 1 WHERE id = $1',
      [clientUpdateId, 'Edited after the fact'],
    );

    const { rows: versionRows } = await client.query<Row>(
      'SELECT title, summary FROM collaboration.publication_version WHERE id = $1',
      [versionId],
    );
    expect(versionRows[0]).toEqual({
      title: 'June visit summary',
      summary: 'Cleared the north bed.',
    });
  });
});
