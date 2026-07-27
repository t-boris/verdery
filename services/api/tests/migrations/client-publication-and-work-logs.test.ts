/**
 * Migration tests for
 * 1786700000000_client-publication-and-work-logs.sql (P9C-DATA-01) — the
 * `work_log` and `client_update` half of the structural completion
 * evidence: every CHECK and uniqueness constraint on those two tables, the
 * privilege posture every table this migration creates is held to, and
 * rollback.
 *
 * Its siblings cover the remaining named evidence:
 * `publication-version-and-items.test.ts` (the structural CHECKs on
 * `publication_version`, `publication_item` and its four detail tables,
 * `publication_staff_attribution`, and `media_entitlement`),
 * `publication-state.test.ts` (state-machine sequencing),
 * `publication-immutability.test.ts` (the REVOKE-enforced tables genuinely
 * cannot be mutated), `publication-snapshot-correctness.test.ts` (a later
 * internal edit does not retroactively change a published snapshot),
 * `publication-media-entitlement.test.ts` (only explicitly entitled media
 * is referenced), and `publication-withdrawal.test.ts` (withdrawal removes
 * a publication from ordinary query scope while preserving identity/audit).
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
import {
  insertClientEngagement,
  insertGardenAssignment,
  insertServiceOrganization,
} from '../support/service-organization-fixtures.js';
import {
  insertClientUpdate,
  insertPublishedClientUpdate,
  insertWorkLog,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'client publication and work logs migration';
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

/** All ten tables this migration creates — used only by the grants and rollback tests below, which are properties of the whole migration, not of `work_log`/`client_update` alone. */
const ALL_NEW_TABLES = [
  'work_log',
  'client_update',
  'publication_version',
  'publication_item',
  'publication_work_log_detail',
  'publication_media_detail',
  'publication_garden_snapshot_detail',
  'publication_timeline_entry_detail',
  'publication_staff_attribution',
  'media_entitlement',
];

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

  // --- work_log ------------------------------------------------------------

  it('rejects a blank work_log description', async () => {
    await expect(
      insertWorkLog(client, gardenId, profileId, { description: '   ' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'work_log_description_not_blank_check' });
  });

  it('allows a work_log with no assignment and no task — the household case', async () => {
    const id = await insertWorkLog(client, gardenId, profileId);
    const { rows } = await client.query<Row>(
      'SELECT assignment_id, task_id FROM collaboration.work_log WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ assignment_id: null, task_id: null });
  });

  it('allows a work_log to reference an assignment', async () => {
    const orgId = await insertServiceOrganization(client);
    const assignmentId = await insertGardenAssignment(
      client,
      orgId,
      profileId,
      gardenId,
      profileId,
    );
    const id = await insertWorkLog(client, gardenId, profileId, { assignment_id: assignmentId });
    const { rows } = await client.query<Row>(
      'SELECT assignment_id FROM collaboration.work_log WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ assignment_id: assignmentId });
  });

  // --- client_update ---------------------------------------------------------

  it('constrains client_update to the known state vocabulary', async () => {
    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        // Every other linkage field satisfied so this fails ONLY the state
        // vocabulary, not also `client_update_published_linkage_check` (an
        // unrecognized state is never in `('internal_draft',
        // 'ready_for_client')`, so without these it would fire too).
        state: 'cancelled',
        summary: 'Draft summary',
        submitted_at: new Date('2026-06-01T09:00:00Z'),
        published_at: new Date('2026-06-01T10:00:00Z'),
        published_by_profile_id: profileId,
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_state_check' });
  });

  it('rejects a blank title and a blank (but non-null) summary', async () => {
    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, { title: '  ' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_title_not_blank_check' });
    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, { summary: '  ' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_summary_not_blank_check' });
  });

  it('requires a summary once a draft leaves internal_draft', async () => {
    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        state: 'ready_for_client',
        submitted_at: new Date('2026-06-01T09:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_summary_required_check' });
  });

  it('ties submitted/published/withdrawn instants and actors to their own states', async () => {
    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        // `summary` set so this fails ONLY the submitted linkage, not also
        // `client_update_summary_required_check`.
        state: 'ready_for_client',
        summary: 'Draft summary',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_update_submitted_linkage_check',
    });

    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        state: 'ready_for_client',
        summary: 'Draft summary',
        submitted_at: new Date('2026-06-01T09:00:00Z'),
        published_by_profile_id: profileId,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_update_published_by_linkage_check',
    });

    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        // `published_at`/`published_by_profile_id` set so this fails ONLY
        // the withdrawn linkage, not also
        // `client_update_published_linkage_check` (a state outside
        // `('internal_draft', 'ready_for_client')` — 'withdrawn' included —
        // always requires a `published_at`, regardless of `withdrawn_at`).
        state: 'withdrawn',
        summary: 'Draft summary',
        submitted_at: new Date('2026-06-01T09:00:00Z'),
        published_at: new Date('2026-06-01T10:00:00Z'),
        published_by_profile_id: profileId,
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_withdrawn_linkage_check' });

    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        state: 'withdrawn',
        summary: 'Draft summary',
        submitted_at: new Date('2026-06-01T09:00:00Z'),
        published_at: new Date('2026-06-01T10:00:00Z'),
        published_by_profile_id: profileId,
        withdrawn_at: new Date('2026-06-01T11:00:00Z'),
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_update_withdrawn_by_linkage_check',
    });

    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        withdrawn_reason: 'client requested removal',
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_withdrawn_reason_check' });
  });

  it('rejects withdrawal that never passed through published (via the broader published-linkage rule), and out-of-order instants', async () => {
    // No dedicated "withdrawn requires published" CHECK exists — see the
    // migration's own comment on why one would be fully redundant.
    // `client_update_published_linkage_check` already rejects this exact
    // row, because 'withdrawn' is a state outside
    // `('internal_draft', 'ready_for_client')` and therefore requires
    // `published_at` regardless of `withdrawn_at`.
    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        state: 'withdrawn',
        summary: 'Draft summary',
        submitted_at: new Date('2026-06-01T09:00:00Z'),
        withdrawn_at: new Date('2026-06-01T10:00:00Z'),
        withdrawn_by_profile_id: profileId,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_update_published_linkage_check',
    });

    await expect(
      insertClientUpdate(client, engagementId, gardenId, profileId, {
        state: 'ready_for_client',
        summary: 'Draft summary',
        submitted_at: new Date('2026-06-01T12:00:00Z'),
        published_at: new Date('2026-06-01T09:00:00Z'),
        published_by_profile_id: profileId,
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_update_submitted_order_check' });
  });

  it('accepts a fully published client_update with every linkage satisfied', async () => {
    const id = await insertPublishedClientUpdate(
      client,
      engagementId,
      gardenId,
      profileId,
      profileId,
    );
    const { rows } = await client.query<Row>(
      'SELECT state FROM collaboration.client_update WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ state: 'published' });
  });

  // --- Privileges and rollback --------------------------------------------

  it('gives work_log and client_update ordinary default grants, and REVOKEs UPDATE/DELETE from the eight immutable tables', async () => {
    const { rows } = await client.query<Row>(
      `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'collaboration'
          AND table_name = ANY($1)`,
      [ALL_NEW_TABLES],
    );

    const grantedFor = (table: string): Set<string> =>
      new Set(
        rows
          .filter((row) => row['table_name'] === table && row['grantee'] === 'verdery_application')
          .map((row) => row['privilege_type'] as string),
      );

    for (const mutableTable of ['work_log', 'client_update']) {
      expect(grantedFor(mutableTable)).toEqual(new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']));
    }

    for (const immutableTable of ALL_NEW_TABLES.filter(
      (table) => table !== 'work_log' && table !== 'client_update',
    )) {
      expect(grantedFor(immutableTable)).toEqual(new Set(['SELECT', 'INSERT']));
    }

    expect(rows.some((row) => row['grantee'] === 'PUBLIC')).toBe(false);
  });

  it('rolls back cleanly, leaving no trace of any of the ten new tables', async () => {
    // `count: 4` undoes this migration and the three migrations applied
    // after it (1786800000000_engagement-publisher-grant-and-client-update-items
    // .sql, 1786900000000_client-invitation-token.sql, and
    // 1787000000000_garden-context-facts.sql, nothing this file's own
    // assertions below check) first, then this migration itself. Update
    // this count when a later migration is added on top — the same
    // convention every earlier migration test in this suite already
    // follows.
    await migrate(databaseUrl, 'down', 4);

    const { rows } = await client.query<Row>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'collaboration' AND table_name = ANY($1)`,
      [ALL_NEW_TABLES],
    );
    expect(rows).toEqual([]);

    // Re-applying must succeed cleanly on top of everything else this
    // database already ran — there is no backfill here to re-exercise,
    // since every one of these tables starts empty.
    await migrate(databaseUrl, 'up');
    const reapplied = await client.query<Row>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'collaboration' AND table_name = 'work_log'`,
    );
    expect(reapplied.rowCount).toBe(1);
  }, 60_000);
});
