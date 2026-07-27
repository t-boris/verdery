/**
 * Migration tests for 1786500000000_collaboration-operations-and-attribution.sql
 * (P9A-DATA-01) — the three properties the work package names as its
 * completion evidence, plus the privilege and rollback posture every
 * migration in this suite is held to.
 *
 * UNIQUENESS: one open access period per membership, one pending ownership
 * transfer per garden, one pending invitation per (garden, intended email),
 * and the P2 constraints this migration had to preserve rather than replace —
 * `owner` still absent from the invitation role vocabulary, one membership
 * per (garden, profile), one invitation per token hash.
 *
 * TEMPORAL STATE: "who had access to this garden on date X" answered by a
 * real query over real rows, including a member removed and later re-invited,
 * whose two disjoint periods a validity column on the membership row could
 * never have held; plus the closure and ordering constraints that keep a
 * half-written period from reading as a current grant, and the backfill that
 * makes the question answerable for memberships older than this migration.
 *
 * The LAST-OWNER evidence the work package also names, together with task
 * assignment, completion attribution, and the audit garden scope, lives in
 * the sibling suite `collaboration-assignment-and-last-owner.test.ts`.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  insertGarden as insertGardenRow,
  insertMembership as insertMembershipRow,
  insertProfile as insertProfileRow,
  insertRow,
} from '../support/collaboration-fixtures.js';
import type { Row } from '../support/collaboration-fixtures.js';

const SUITE_NAME = 'collaboration operations and attribution migration';
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
const MAY = new Date('2026-05-10T09:00:00Z');
const JULY = new Date('2026-07-10T09:00:00Z');
const SEPTEMBER = new Date('2026-09-10T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let databaseUrl: string;
  let profileId: string;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    databaseUrl = container.getConnectionUri();

    await migrate(databaseUrl, 'up');

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    profileId = await insertProfile();
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  const insertProfile = (): Promise<string> => insertProfileRow(client);
  const insertGarden = (): Promise<string> => insertGardenRow(client, profileId);
  const insertMembership = (gardenId: string, memberId: string, role?: string): Promise<string> =>
    insertMembershipRow(client, gardenId, memberId, role);

  async function insertPeriod(
    membershipId: string,
    gardenId: string,
    memberId: string,
    overrides: Row = {},
  ): Promise<string> {
    return insertRow(client, 'collaboration.membership_period', {
      id: randomUUID(),
      membership_id: membershipId,
      garden_id: gardenId,
      profile_id: memberId,
      role: 'editor',
      valid_from: JANUARY,
      ...overrides,
    });
  }

  async function insertTransfer(gardenId: string, overrides: Row = {}): Promise<string> {
    const to = await insertProfile();
    return insertRow(client, 'collaboration.ownership_transfer', {
      id: randomUUID(),
      garden_id: gardenId,
      from_profile_id: profileId,
      to_profile_id: to,
      from_resulting_role: 'editor',
      authenticated_at: JANUARY,
      requested_at: JANUARY,
      ...overrides,
    });
  }

  async function insertInvitation(gardenId: string, overrides: Row = {}): Promise<string> {
    return insertRow(client, 'collaboration.invitation', {
      id: randomUUID(),
      garden_id: gardenId,
      inviter_profile_id: profileId,
      intended_role: 'editor',
      token_hash: randomUUID(),
      expires_at: SEPTEMBER,
      ...overrides,
    });
  }

  // --- Uniqueness -------------------------------------------------------

  it('allows one open access period per membership and any number of closed ones', async () => {
    const gardenId = await insertGarden();
    const memberId = await insertProfile();
    const membershipId = await insertMembership(gardenId, memberId);

    await insertPeriod(membershipId, gardenId, memberId);

    // A second open period would mean two simultaneous grants to one person.
    await expect(insertPeriod(membershipId, gardenId, memberId)).rejects.toMatchObject({
      code: '23505',
      constraint: 'membership_period_open_key',
    });

    // Closing the first frees the slot, and the closed rows accumulate.
    await client.query(
      `UPDATE collaboration.membership_period
          SET valid_until = $2, ended_reason = 'role_changed'
        WHERE membership_id = $1 AND valid_until IS NULL`,
      [membershipId, MARCH],
    );
    await insertPeriod(membershipId, gardenId, memberId, {
      role: 'viewer',
      valid_from: MARCH,
      valid_until: MAY,
      ended_reason: 'removed',
    });
    await insertPeriod(membershipId, gardenId, memberId, { valid_from: JULY });

    const { rows } = await client.query<Row>(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE valid_until IS NULL))::int AS open
         FROM collaboration.membership_period WHERE membership_id = $1`,
      [membershipId],
    );
    expect(rows[0]).toEqual({ total: 3, open: 1 });
  });

  it('allows one pending ownership transfer per garden while keeping the settled ones', async () => {
    const gardenId = await insertGarden();

    const pending = await insertTransfer(gardenId);
    await expect(insertTransfer(gardenId)).rejects.toMatchObject({
      code: '23505',
      constraint: 'ownership_transfer_pending_key',
    });

    // Settling the first releases the slot; the history stays.
    await client.query(
      `UPDATE collaboration.ownership_transfer
          SET state = 'cancelled', cancelled_at = $2, cancellation_reason = 'superseded'
        WHERE id = $1`,
      [pending, MARCH],
    );
    await insertTransfer(gardenId, { state: 'completed', completed_at: MARCH });
    await insertTransfer(gardenId);

    const { rows } = await client.query<Row>(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE state = 'pending'))::int AS pending
         FROM collaboration.ownership_transfer WHERE garden_id = $1`,
      [gardenId],
    );
    expect(rows[0]).toEqual({ total: 3, pending: 1 });
  });

  it('allows one pending invitation per garden and intended email, and unbound invitations without limit', async () => {
    const gardenId = await insertGarden();
    const email = 'partner@example.test';

    await insertInvitation(gardenId, { intended_email: email });
    await expect(insertInvitation(gardenId, { intended_email: email })).rejects.toMatchObject({
      code: '23505',
      constraint: 'invitation_pending_intended_email_key',
    });

    // A terminal invitation never blocks a fresh one: people get re-invited.
    await client.query(
      `UPDATE collaboration.invitation SET state = 'revoked', revoked_at = $2
        WHERE garden_id = $1`,
      [gardenId, MARCH],
    );
    await insertInvitation(gardenId, { intended_email: email });

    // Unbound invitations (no intended email) are outside the index entirely.
    await insertInvitation(gardenId);
    await insertInvitation(gardenId);

    // A different garden is a different invitation surface.
    await insertInvitation(await insertGarden(), { intended_email: email });
  });

  it('preserves the P2 constraints it completes rather than replaces', async () => {
    const gardenId = await insertGarden();
    const memberId = await insertProfile();

    // Ownership still never travels by invitation: it moves only through the
    // dedicated transfer flow.
    await expect(insertInvitation(gardenId, { intended_role: 'owner' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'invitation_intended_role_check',
    });

    const tokenHash = randomUUID();
    await insertInvitation(gardenId, { token_hash: tokenHash });
    await expect(insertInvitation(gardenId, { token_hash: tokenHash })).rejects.toMatchObject({
      code: '23505',
      constraint: 'invitation_token_hash_key',
    });

    await insertMembership(gardenId, memberId);
    await expect(insertMembership(gardenId, memberId, 'viewer')).rejects.toMatchObject({
      code: '23505',
      constraint: 'membership_garden_profile_key',
    });

    // Co-ownership was already representable and still is.
    const second = await insertProfile();
    await insertMembership(gardenId, profileId, 'owner');
    await insertMembership(gardenId, second, 'owner');
    const { rows } = await client.query<Row>(
      `SELECT count(*)::int AS owners FROM collaboration.membership
        WHERE garden_id = $1 AND role = 'owner' AND state = 'active'`,
      [gardenId],
    );
    expect(rows[0]).toEqual({ owners: 2 });
  });

  // --- Temporal state ---------------------------------------------------

  it('answers "who had access on date X" from the period table, including a member who left and came back', async () => {
    const gardenId = await insertGarden();
    const owner = await insertProfile();
    const returner = await insertProfile();
    const ownerMembership = await insertMembership(gardenId, owner, 'owner');
    const returnerMembership = await insertMembership(gardenId, returner);

    // The owner has held the garden since January and still does.
    await insertPeriod(ownerMembership, gardenId, owner, { role: 'owner', valid_from: JANUARY });
    // The returner was an editor from January to March, gone until July, then
    // a viewer again. Two disjoint intervals — the exact history a validity
    // column on the single `UNIQUE (garden_id, profile_id)` membership row
    // could not have held.
    await insertPeriod(returnerMembership, gardenId, returner, {
      valid_from: JANUARY,
      valid_until: MARCH,
      ended_reason: 'removed',
    });
    await insertPeriod(returnerMembership, gardenId, returner, {
      role: 'viewer',
      valid_from: JULY,
    });

    const accessOn = async (moment: Date): Promise<Row[]> => {
      const { rows } = await client.query<Row>(
        `SELECT profile_id, role FROM collaboration.membership_period
          WHERE garden_id = $1
            AND valid_from <= $2
            AND (valid_until IS NULL OR valid_until > $2)
          ORDER BY role`,
        [gardenId, moment],
      );
      return rows;
    };

    expect(await accessOn(JANUARY)).toEqual([
      { profile_id: returner, role: 'editor' },
      { profile_id: owner, role: 'owner' },
    ]);
    // May: the returner is gone, the owner remains.
    expect(await accessOn(MAY)).toEqual([{ profile_id: owner, role: 'owner' }]);
    expect(await accessOn(SEPTEMBER)).toEqual([
      { profile_id: owner, role: 'owner' },
      { profile_id: returner, role: 'viewer' },
    ]);
  });

  it('rejects a period that ends before it starts, or that is half-closed in either direction', async () => {
    const gardenId = await insertGarden();
    const memberId = await insertProfile();
    const membershipId = await insertMembership(gardenId, memberId);

    await expect(
      insertPeriod(membershipId, gardenId, memberId, {
        valid_from: MAY,
        valid_until: MARCH,
        ended_reason: 'removed',
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'membership_period_order_check' });

    // An end instant without a reason, and a reason without an end instant,
    // are both a half-written close.
    await expect(
      insertPeriod(membershipId, gardenId, memberId, { valid_until: MARCH }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'membership_period_closure_check' });
    await expect(
      insertPeriod(membershipId, gardenId, memberId, { ended_reason: 'removed' }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'membership_period_closure_check' });

    await expect(
      insertPeriod(membershipId, gardenId, memberId, {
        valid_until: MARCH,
        ended_reason: 'transferred',
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'membership_period_ended_reason_check' });
  });

  it('cascades a membership deletion into its periods, since intervals of a deleted grant describe nothing', async () => {
    const gardenId = await insertGarden();
    const memberId = await insertProfile();
    const membershipId = await insertMembership(gardenId, memberId);
    await insertPeriod(membershipId, gardenId, memberId);

    await client.query('DELETE FROM collaboration.membership WHERE id = $1', [membershipId]);

    const { rows } = await client.query<Row>(
      'SELECT count(*)::int AS remaining FROM collaboration.membership_period WHERE membership_id = $1',
      [membershipId],
    );
    expect(rows[0]).toEqual({ remaining: 0 });
  });

  // --- Ownership transfer -----------------------------------------------

  it('keeps an ownership transfer internally consistent: two parties, a settled state, and a recent authentication', async () => {
    const gardenId = await insertGarden();

    await expect(insertTransfer(gardenId, { to_profile_id: profileId })).rejects.toMatchObject({
      code: '23514',
      constraint: 'ownership_transfer_distinct_parties_check',
    });
    // A giver who stays an owner is a co-owner promotion, not a transfer.
    await expect(insertTransfer(gardenId, { from_resulting_role: 'owner' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'ownership_transfer_from_resulting_role_check',
    });
    await expect(insertTransfer(gardenId, { state: 'completed' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'ownership_transfer_completed_linkage_check',
    });
    await expect(
      insertTransfer(gardenId, { state: 'cancelled', cancelled_at: null }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'ownership_transfer_cancelled_linkage_check',
    });
    await expect(
      insertTransfer(gardenId, { cancellation_reason: 'changed my mind' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'ownership_transfer_cancellation_reason_check',
    });
    // The sensitive-action authentication cannot postdate the request it
    // supposedly authorized.
    await expect(insertTransfer(gardenId, { authenticated_at: MAY })).rejects.toMatchObject({
      code: '23514',
      constraint: 'ownership_transfer_authentication_order_check',
    });
  });

  // --- Invitation lifecycle ---------------------------------------------

  it('ties an accepted invitation to its acceptance instant and the membership it produced', async () => {
    const gardenId = await insertGarden();
    const memberId = await insertProfile();
    const membershipId = await insertMembership(gardenId, memberId);

    await expect(insertInvitation(gardenId, { state: 'accepted' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'invitation_accepted_linkage_check',
    });
    // ...and the instant cannot appear on an invitation that was not accepted.
    await expect(insertInvitation(gardenId, { accepted_at: MARCH })).rejects.toMatchObject({
      code: '23514',
      constraint: 'invitation_accepted_linkage_check',
    });
    // Nor can a pending invitation claim to have produced a membership.
    await expect(
      insertInvitation(gardenId, { resulting_membership_id: membershipId }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invitation_resulting_membership_check',
    });

    const accepted = await insertInvitation(gardenId, {
      state: 'accepted',
      accepted_at: MARCH,
      accepted_by_profile_id: memberId,
      resulting_membership_id: membershipId,
    });

    // The account purge RELEASES `accepted_by_profile_id` on a surviving
    // garden's invitation (P8-DELETE-01's own preparation step). The
    // acceptance CHECK deliberately excludes that column so the release stays
    // possible — this is the interaction, exercised.
    await client.query(
      `UPDATE collaboration.invitation SET accepted_by_profile_id = NULL WHERE id = $1`,
      [accepted],
    );
    const { rows } = await client.query<Row>(
      'SELECT state, accepted_by_profile_id FROM collaboration.invitation WHERE id = $1',
      [accepted],
    );
    expect(rows[0]).toEqual({ state: 'accepted', accepted_by_profile_id: null });
  });

  it('ties a revoked invitation to its revocation instant and stores intended emails normalized', async () => {
    const gardenId = await insertGarden();

    await expect(insertInvitation(gardenId, { state: 'revoked' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'invitation_revoked_linkage_check',
    });
    await expect(insertInvitation(gardenId, { revoked_at: MARCH })).rejects.toMatchObject({
      code: '23514',
      constraint: 'invitation_revoked_linkage_check',
    });
    // Without normalization the pending-email uniqueness index above would be
    // defeated by capitalization alone.
    await expect(
      insertInvitation(gardenId, { intended_email: 'Partner@Example.test' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'invitation_intended_email_normalized_check',
    });
  });

  // --- Privileges and rollback ------------------------------------------

  it('grants verdery_application row access to the new tables through the schema default privileges', async () => {
    const { rows } = await client.query<Row>(
      `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'collaboration'
          AND table_name IN ('membership_period', 'ownership_transfer')`,
    );

    for (const table of ['membership_period', 'ownership_transfer']) {
      const granted = new Set(
        rows
          .filter((row) => row['table_name'] === table && row['grantee'] === 'verdery_application')
          .map((row) => row['privilege_type']),
      );
      expect(granted).toEqual(new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']));
    }
    expect(rows.some((row) => row['grantee'] === 'PUBLIC')).toBe(false);
  });

  it('rolls back cleanly, and re-applying backfills a period for every membership that already existed', async () => {
    // `count: 5` undoes this migration and the four migrations applied
    // after it (1786600000000_service-organizations-and-client-engagements
    // .sql, 1786700000000_client-publication-and-work-logs.sql,
    // 1786800000000_engagement-publisher-grant-and-client-update-items.sql,
    // and 1786900000000_client-invitation-token.sql, nothing this file's
    // own assertions below check) first, then this migration itself. Update
    // this count when a later migration is added on top.
    await migrate(databaseUrl, 'down', 5);

    const tables = await client.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'collaboration'
          AND table_name IN ('membership_period', 'ownership_transfer')`,
    );
    expect(tables.rowCount).toBe(0);

    const columns = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE (table_schema, table_name, column_name) IN (
                ('collaboration', 'invitation', 'accepted_at'),
                ('collaboration', 'invitation', 'revoked_at'),
                ('collaboration', 'invitation', 'resulting_membership_id'),
                ('tasks_recommendations', 'task', 'assigned_profile_id'),
                ('tasks_recommendations', 'task', 'assigned_at'),
                ('tasks_recommendations', 'task', 'completed_by_profile_id'),
                ('tasks_recommendations', 'task_revision', 'assigned_profile_id'),
                ('platform', 'audit_event', 'garden_id')
              )`,
    );
    expect(columns.rowCount).toBe(0);

    // A database at the PRIOR schema, carrying memberships written before
    // this migration existed — the upgrade case the fresh-database run can
    // never reach.
    const gardenId = await insertGarden();
    const stayer = await insertProfile();
    const leaver = await insertProfile();
    const staying = await insertMembership(gardenId, stayer, 'owner');
    const leaving = await insertMembership(gardenId, leaver);
    await client.query(
      `UPDATE collaboration.membership SET created_at = $2, updated_at = $2 WHERE id = $1`,
      [staying, JANUARY],
    );
    await client.query(
      `UPDATE collaboration.membership
          SET state = 'removed', created_at = $2, updated_at = $3 WHERE id = $1`,
      [leaving, JANUARY, MAY],
    );

    // Invitations that already reached a terminal state under the prior
    // schema, which has nowhere to record WHEN they did. Re-applying the
    // migration over these is what a rollback-then-redeploy actually does,
    // and it is the case that would fail if the linkage CHECKs were added
    // over rows the migration had not first repaired.
    const revokedId = await insertInvitation(gardenId, { state: 'revoked' });
    const acceptedId = await insertInvitation(gardenId, {
      state: 'accepted',
      accepted_by_profile_id: stayer,
    });

    await migrate(databaseUrl, 'up');

    const repaired = await client.query<Row>(
      `SELECT id, accepted_at = created_at AS accepted_stamped,
              revoked_at = created_at AS revoked_stamped, resulting_membership_id
         FROM collaboration.invitation WHERE id = ANY($1) ORDER BY id`,
      [[revokedId, acceptedId].sort()],
    );
    expect(
      repaired.rows.map((row) => ({
        stamped: row['accepted_stamped'] ?? row['revoked_stamped'],
        membership: row['resulting_membership_id'],
      })),
    ).toEqual(
      [revokedId, acceptedId]
        .sort()
        .map((id) => ({ stamped: true, membership: id === acceptedId ? staying : null })),
    );

    const { rows } = await client.query<Row>(
      `SELECT membership_id, role, ended_reason, valid_until IS NULL AS still_open
         FROM collaboration.membership_period
        WHERE garden_id = $1
        ORDER BY still_open DESC`,
      [gardenId],
    );
    expect(rows).toEqual([
      { membership_id: staying, role: 'owner', ended_reason: null, still_open: true },
      { membership_id: leaving, role: 'editor', ended_reason: 'removed', still_open: false },
    ]);

    // The backfilled period spans exactly the access it describes: from the
    // grant instant to the revocation instant.
    const closed = await client.query<Row>(
      'SELECT valid_from, valid_until FROM collaboration.membership_period WHERE membership_id = $1',
      [leaving],
    );
    expect(closed.rows[0]).toEqual({ valid_from: JANUARY, valid_until: MAY });
  }, 60_000);
});
