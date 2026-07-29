/**
 * Migration tests for 1786900000000_client-invitation-token.sql
 * (P9C-INVITE-01) — the token/expiry columns and the `expired` state
 * completing the `collaboration.client_access_grant` skeleton
 * `1786600000000_service-organizations-and-client-engagements.sql`
 * deliberately left partial: the paired-column linkage CHECK, the
 * expired-requires-token CHECK, the widened state vocabulary, the partial
 * unique token-hash index, and rollback (including the down migration's own
 * `expired -> revoked` coercion of any row that would otherwise violate the
 * restored, narrower CHECK).
 *
 * Source: implementation-plan.md work package P9C-INVITE-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile } from '../support/collaboration-fixtures.js';
import type { Row } from '../support/collaboration-fixtures.js';
import {
  insertClientAccessGrant,
  insertClientEngagement,
} from '../support/service-organization-fixtures.js';

const SUITE_NAME = 'client invitation token migration';
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

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;
  let gardenId: string;
  let engagementId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

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

  function grantOverrides(overrides: Row = {}): Row {
    return {
      invited_email: `client-${randomUUID()}@example.test`,
      state: 'pending',
      token_hash: randomUUID(),
      expires_at: MARCH,
      created_at: JANUARY,
      ...overrides,
    };
  }

  it('accepts a grant with no token at all — the direct-grant door P9B-DATA-01 left open', async () => {
    const id = await insertClientAccessGrant(client, engagementId, {
      client_profile_id: profileId,
      invited_email: null,
      state: 'active',
      granted_at: JANUARY,
      token_hash: null,
      expires_at: null,
    });

    const row = await client.query(
      `SELECT token_hash, expires_at FROM collaboration.client_access_grant WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ token_hash: null, expires_at: null });
  });

  it('rejects a token_hash with no expires_at, and an expires_at with no token_hash', async () => {
    await expect(
      insertClientAccessGrant(client, engagementId, grantOverrides({ expires_at: null })),
    ).rejects.toMatchObject({ constraint: 'client_access_grant_token_linkage_check' });

    await expect(
      insertClientAccessGrant(client, engagementId, grantOverrides({ token_hash: null })),
    ).rejects.toMatchObject({ constraint: 'client_access_grant_token_linkage_check' });
  });

  it('accepts the widened `expired` state, but only paired with a token', async () => {
    await expect(
      insertClientAccessGrant(
        client,
        engagementId,
        grantOverrides({ state: 'expired', token_hash: null, expires_at: null }),
      ),
    ).rejects.toMatchObject({ constraint: 'client_access_grant_expired_requires_token_check' });

    const id = await insertClientAccessGrant(
      client,
      engagementId,
      grantOverrides({ state: 'expired' }),
    );
    const row = await client.query(
      `SELECT state FROM collaboration.client_access_grant WHERE id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ state: 'expired' });
  });

  it('rejects a state outside pending/active/revoked/expired', async () => {
    await expect(
      insertClientAccessGrant(client, engagementId, grantOverrides({ state: 'accepted' })),
    ).rejects.toMatchObject({ constraint: 'client_access_grant_state_check' });
  });

  it('enforces one row per non-null token_hash', async () => {
    const sharedTokenHash = randomUUID();
    await insertClientAccessGrant(
      client,
      engagementId,
      grantOverrides({ token_hash: sharedTokenHash }),
    );

    await expect(
      insertClientAccessGrant(
        client,
        engagementId,
        grantOverrides({ token_hash: sharedTokenHash }),
      ),
    ).rejects.toMatchObject({ constraint: 'client_access_grant_token_hash_key' });
  });

  it('never conflicts two grants that both carry no token at all', async () => {
    await insertClientAccessGrant(client, engagementId, {
      client_profile_id: await insertProfile(client),
      invited_email: null,
      state: 'active',
      granted_at: JANUARY,
      token_hash: null,
      expires_at: null,
    });

    await expect(
      insertClientAccessGrant(client, engagementId, {
        client_profile_id: await insertProfile(client),
        invited_email: null,
        state: 'active',
        granted_at: JANUARY,
        token_hash: null,
        expires_at: null,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it('rolls back: the token/expiry columns and the widened CHECK are gone, and an existing `expired` row is coerced to `revoked` rather than aborting the migration', async () => {
    const expiredId = await insertClientAccessGrant(
      client,
      engagementId,
      grantOverrides({ state: 'expired' }),
    );

    await client.end();

    // `count: 8` undoes every migration applied after this one (through
    // 1787600000000_plant-candidates-and-conversion.sql, nothing this
    // file's own assertions below check) first, then this migration itself.
    // Update this count when a later migration is added on top, the same
    // convention every earlier migration test here follows.
    await migrate(databaseUrl, 'down', 8);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'collaboration' AND table_name = 'client_access_grant'
          AND column_name IN ('token_hash', 'expires_at')`,
    );
    expect(columns.rows).toHaveLength(0);

    const index = await client.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'collaboration' AND indexname = 'client_access_grant_token_hash_key'`,
    );
    expect(index.rows).toHaveLength(0);

    // Coerced, not aborted: the row that was `expired` before rollback
    // survives as `revoked`, with a real `revoked_at`.
    const coerced = await client.query<{ state: string; revoked_at: Date | null }>(
      `SELECT state, revoked_at FROM collaboration.client_access_grant WHERE id = $1`,
      [expiredId],
    );
    expect(coerced.rows[0]?.state).toBe('revoked');
    expect(coerced.rows[0]?.revoked_at).not.toBeNull();

    // The restored, narrower CHECK refuses `expired` again.
    await expect(
      client.query(
        `INSERT INTO collaboration.client_access_grant (id, engagement_id, invited_email, state)
         VALUES ($1, $2, $3, 'expired')`,
        [randomUUID(), engagementId, `reject-${randomUUID()}@example.test`],
      ),
    ).rejects.toMatchObject({ constraint: 'client_access_grant_state_check' });

    // Re-applying must succeed cleanly on top of everything else this
    // database already ran.
    await client.end();
    await migrate(databaseUrl, 'up');
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
  });
});
