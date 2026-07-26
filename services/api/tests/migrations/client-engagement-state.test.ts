/**
 * The client-engagement half of the P9B-DATA-01 migration suite's completion
 * evidence: "engagement-state transitions" tests, for
 * `collaboration.client_engagement`'s
 * `draft -> active -> ended`, `draft/active -> revoked` diagram
 * (collaboration-and-client-sharing.md section 8).
 *
 * Proves the linkage CHECKs the database CAN enforce (an internally
 * consistent row for each state), then — matching the honesty
 * `collaboration-assignment-and-last-owner.test.ts` already established for
 * the last-owner invariant — proves what it cannot: the SEQUENCE of states a
 * row moves through, and the cross-table "at least one client" activation
 * precondition. `src/modules/collaboration/domain/client-engagement-state
 * .test.ts` is the pure-function counterpart that pins the sequencing rule
 * itself.
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

const SUITE_NAME = 'client engagement state migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

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

  async function freshGarden(): Promise<string> {
    return insertGarden(client, profileId);
  }

  it('starts a new engagement as draft, never activated, ended, or revoked', async () => {
    const id = await insertClientEngagement(client, await freshGarden(), profileId);
    const { rows } = await client.query<Row>(
      'SELECT state, activated_at, ended_at, revoked_at FROM collaboration.client_engagement WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      state: 'draft',
      activated_at: null,
      ended_at: null,
      revoked_at: null,
    });
  });

  it('requires activated_at once a row claims to be active, but not for a revoked-from-draft row', async () => {
    const g = await freshGarden();
    await expect(
      insertClientEngagement(client, g, profileId, { state: 'active' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_engagement_activated_linkage_check',
    });
    // 'ended' without ever having activated is rejected too, but through
    // `client_engagement_ended_order_check` (its own test below) rather than
    // this one: an `ended_at` with no `activated_at` violates BOTH checks at
    // once, since the order check's own second branch also requires
    // `activated_at` the moment `ended_at` is present.

    // Revoked directly from draft: no activation ever happened, and that is fine.
    const revokedFromDraft = await insertClientEngagement(client, g, profileId, {
      state: 'revoked',
      revoked_at: JANUARY,
    });
    const { rows } = await client.query<Row>(
      'SELECT activated_at FROM collaboration.client_engagement WHERE id = $1',
      [revokedFromDraft],
    );
    expect(rows[0]).toEqual({ activated_at: null });
  });

  it('ties ended to its own instant, and requires the instant to postdate activation', async () => {
    const g = await freshGarden();

    await expect(
      insertClientEngagement(client, g, profileId, { state: 'ended', activated_at: JANUARY }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_engagement_ended_linkage_check' });
    await expect(
      insertClientEngagement(client, g, profileId, { activated_at: JANUARY, ended_at: MARCH }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_engagement_ended_linkage_check' });

    await expect(
      insertClientEngagement(client, g, profileId, {
        state: 'ended',
        activated_at: MARCH,
        ended_at: JANUARY,
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_engagement_ended_order_check' });

    const id = await insertClientEngagement(client, g, profileId, {
      state: 'ended',
      activated_at: JANUARY,
      ended_at: MARCH,
    });
    const { rows } = await client.query<Row>(
      'SELECT state FROM collaboration.client_engagement WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ state: 'ended' });
  });

  it('ties revoked to its own instant, and confines the reason to a revoked row', async () => {
    const g = await freshGarden();

    await expect(
      insertClientEngagement(client, g, profileId, { state: 'revoked' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_engagement_revoked_linkage_check',
    });
    await expect(
      insertClientEngagement(client, g, profileId, { revoked_at: MARCH }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_engagement_revoked_linkage_check',
    });
    await expect(
      insertClientEngagement(client, g, profileId, {
        revoked_reason: 'client requested cancellation',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_engagement_revoked_reason_check',
    });

    const id = await insertClientEngagement(client, g, profileId, {
      state: 'revoked',
      revoked_at: MARCH,
      revoked_reason: 'client requested cancellation',
    });
    const { rows } = await client.query<Row>(
      'SELECT revoked_reason FROM collaboration.client_engagement WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ revoked_reason: 'client requested cancellation' });
  });

  it('does NOT stop an engagement from skipping states or walking backwards: sequencing is application-enforced', async () => {
    const g = await freshGarden();
    const id = await insertClientEngagement(client, g, profileId, {
      state: 'active',
      activated_at: JANUARY,
    });

    // No trigger compares this row's OLD state to its NEW one. The database
    // happily accepts jumping straight back to 'draft' from 'active' — the
    // exact sequencing gap `client-engagement-state.ts`'s pure function
    // exists to close at the application layer, and the exact honesty
    // pattern the last-owner invariant already established: recorded here so
    // nobody reads the linkage CHECKs above and assumes they also guard
    // transition ORDER.
    await client.query(
      `UPDATE collaboration.client_engagement
          SET state = 'draft', activated_at = NULL
        WHERE id = $1`,
      [id],
    );
    const { rows } = await client.query<Row>(
      'SELECT state, activated_at FROM collaboration.client_engagement WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ state: 'draft', activated_at: null });
  });

  it('does NOT stop an engagement from becoming active with zero client_access_grant rows', async () => {
    const g = await freshGarden();
    const id = await insertClientEngagement(client, g, profileId, {
      state: 'active',
      activated_at: JANUARY,
    });

    // "Activation requires ... one client identity or pending bound
    // invitation" (collaboration-and-client-sharing.md section 8) is a
    // cross-table fact no CHECK on this single row can see — recorded here,
    // not assumed. Application-guaranteed by whichever command activates an
    // engagement (P9B-API-01).
    const { rows } = await client.query<Row>(
      `SELECT count(*)::int AS grants FROM collaboration.client_access_grant WHERE engagement_id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ grants: 0 });

    const { rows: engagement } = await client.query<Row>(
      'SELECT state FROM collaboration.client_engagement WHERE id = $1',
      [id],
    );
    expect(engagement[0]).toEqual({ state: 'active' });
  });
});
