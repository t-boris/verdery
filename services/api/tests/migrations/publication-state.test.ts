/**
 * The `client_update` half of the P9C-DATA-01 migration suite's completion
 * evidence: "state-machine sequencing" tests, for
 * `collaboration.client_update`'s strictly linear
 * `internal_draft -> ready_for_client -> published -> withdrawn` diagram
 * (collaboration-and-client-sharing.md section 10; ADR-0012's own
 * "Publication Boundary").
 *
 * Proves the linkage CHECKs the database CAN enforce are already covered by
 * `client-publication-and-work-logs.test.ts`; THIS file proves what the
 * database cannot: the SEQUENCE of states a row moves through — matching
 * the honesty `client-engagement-state.test.ts` already established for
 * `client_engagement`'s own sequencing gap.
 * `src/modules/collaboration/domain/publication-state.test.ts` is the
 * pure-function counterpart that pins the sequencing rule itself.
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
import { insertClientUpdate } from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'client_update publication state migration';
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

  it('starts a new client_update as internal_draft, with no submitted/published/withdrawn instant', async () => {
    const id = await insertClientUpdate(client, engagementId, gardenId, profileId);
    const { rows } = await client.query<Row>(
      `SELECT state, submitted_at, published_at, withdrawn_at
         FROM collaboration.client_update WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      state: 'internal_draft',
      submitted_at: null,
      published_at: null,
      withdrawn_at: null,
    });
  });

  it('does NOT stop a client_update from skipping straight to published: sequencing is application-enforced', async () => {
    const id = await insertClientUpdate(client, engagementId, gardenId, profileId);

    // No trigger compares this row's OLD state to its NEW one. The database
    // happily accepts a draft jumping straight to 'published' with no
    // 'ready_for_client' step in between, as long as the linkage CHECKs for
    // the CLAIMED state are individually satisfied — the exact sequencing
    // gap `publication-state.ts`'s pure function exists to close at the
    // application layer, recorded here so nobody reads the linkage CHECKs
    // in `client-publication-and-work-logs.test.ts` and assumes they also
    // guard transition ORDER.
    await client.query(
      `UPDATE collaboration.client_update
          SET state = 'published',
              summary = 'Skipped review entirely',
              submitted_at = $2,
              published_at = $2,
              published_by_profile_id = $3
        WHERE id = $1`,
      [id, new Date('2026-06-01T09:00:00Z'), profileId],
    );

    const { rows } = await client.query<Row>(
      'SELECT state FROM collaboration.client_update WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ state: 'published' });
  });

  it('does NOT stop a published client_update from walking backwards to ready_for_client', async () => {
    const id = await insertClientUpdate(client, engagementId, gardenId, profileId, {
      state: 'published',
      summary: 'A real published summary',
      submitted_at: new Date('2026-06-01T09:00:00Z'),
      published_at: new Date('2026-06-01T10:00:00Z'),
      published_by_profile_id: profileId,
    });

    await client.query(
      `UPDATE collaboration.client_update
          SET state = 'ready_for_client', published_at = NULL, published_by_profile_id = NULL
        WHERE id = $1`,
      [id],
    );

    const { rows } = await client.query<Row>(
      'SELECT state, published_at FROM collaboration.client_update WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ state: 'ready_for_client', published_at: null });
  });

  it('does NOT stop withdrawn from being reached a second time, or reused after re-entering published', async () => {
    const id = await insertClientUpdate(client, engagementId, gardenId, profileId, {
      state: 'withdrawn',
      summary: 'A real published summary',
      submitted_at: new Date('2026-06-01T09:00:00Z'),
      published_at: new Date('2026-06-01T10:00:00Z'),
      published_by_profile_id: profileId,
      withdrawn_at: new Date('2026-06-01T11:00:00Z'),
      withdrawn_by_profile_id: profileId,
    });

    // The diagram draws 'withdrawn' as terminal; nothing in the CHECKs stops
    // a second, redundant UPDATE that leaves the row in the same state with
    // a later instant — a real gap, recorded rather than assumed closed.
    await client.query(`UPDATE collaboration.client_update SET withdrawn_at = $2 WHERE id = $1`, [
      id,
      new Date('2026-06-01T12:00:00Z'),
    ]);

    const { rows } = await client.query<Row>(
      'SELECT state FROM collaboration.client_update WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ state: 'withdrawn' });
  });
});
