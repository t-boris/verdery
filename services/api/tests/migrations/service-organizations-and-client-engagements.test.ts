/**
 * Migration tests for
 * 1786600000000_service-organizations-and-client-engagements.sql
 * (P9B-DATA-01) — the structural half of the work package's completion
 * evidence: every CHECK and uniqueness constraint on
 * `service_organization`, `organization_membership`,
 * `organization_membership_period`, `client_engagement`, and
 * `client_access_grant`, the temporal "who had access when" query the period
 * table exists to answer, the privilege posture every migration in this
 * suite is held to, and rollback.
 *
 * Its siblings cover the remaining named evidence: `garden-assignment-
 * lifecycle.test.ts` (assignment lifecycle), `service-organization-tenant-
 * isolation.test.ts` (tenant isolation), and `client-engagement-state.test.ts`
 * (engagement-state transitions).
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
  insertClientAccessGrant,
  insertClientEngagement,
  insertOrganizationMembership,
  insertOrganizationMembershipPeriod,
  insertServiceOrganization,
} from '../support/service-organization-fixtures.js';

const SUITE_NAME = 'service organizations and client engagements migration';
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

    profileId = await insertProfile(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  // --- service_organization ----------------------------------------------

  it('rejects a blank organization name', async () => {
    await expect(insertServiceOrganization(client, { name: '   ' })).rejects.toMatchObject({
      code: '23514',
      constraint: 'service_organization_name_not_blank_check',
    });
  });

  // --- organization_membership --------------------------------------------

  it('constrains membership to one row per (organization, profile), the known role and state vocabularies', async () => {
    const orgId = await insertServiceOrganization(client);
    const memberId = await insertProfile(client);

    await insertOrganizationMembership(client, orgId, memberId, 'professional');
    await expect(
      insertOrganizationMembership(client, orgId, memberId, 'organization_admin'),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'organization_membership_org_profile_key',
    });

    await expect(
      insertOrganizationMembership(client, orgId, await insertProfile(client), 'owner'),
    ).rejects.toMatchObject({ code: '23514', constraint: 'organization_membership_role_check' });

    await expect(
      insertOrganizationMembership(
        client,
        orgId,
        await insertProfile(client),
        'professional',
        'suspended',
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'organization_membership_state_check' });

    // Two admins on one organization is representable, same as two owners on
    // one garden — nothing here forces exactly one.
    const secondAdmin = await insertProfile(client);
    await insertOrganizationMembership(client, orgId, profileId, 'organization_admin');
    await insertOrganizationMembership(client, orgId, secondAdmin, 'organization_admin');
    const { rows } = await client.query<Row>(
      `SELECT count(*)::int AS admins FROM collaboration.organization_membership
        WHERE organization_id = $1 AND role = 'organization_admin' AND state = 'active'`,
      [orgId],
    );
    expect(rows[0]).toEqual({ admins: 2 });
  });

  // --- organization_membership_period -------------------------------------

  it('allows one open membership period per organization membership, and any number of closed ones', async () => {
    const orgId = await insertServiceOrganization(client);
    const memberId = await insertProfile(client);
    const membershipId = await insertOrganizationMembership(client, orgId, memberId);

    await insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId);

    await expect(
      insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'organization_membership_period_open_key',
    });

    await client.query(
      `UPDATE collaboration.organization_membership_period
          SET valid_until = $2, ended_reason = 'role_changed'
        WHERE membership_id = $1 AND valid_until IS NULL`,
      [membershipId, MARCH],
    );
    await insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId, {
      role: 'organization_admin',
      valid_from: MARCH,
      valid_until: MAY,
      ended_reason: 'removed',
    });
    await insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId, {
      valid_from: JULY,
    });

    const { rows } = await client.query<Row>(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE valid_until IS NULL))::int AS open
         FROM collaboration.organization_membership_period WHERE membership_id = $1`,
      [membershipId],
    );
    expect(rows[0]).toEqual({ total: 3, open: 1 });
  });

  it('rejects a half-closed or backwards membership period, and an unproducible ended reason', async () => {
    const orgId = await insertServiceOrganization(client);
    const memberId = await insertProfile(client);
    const membershipId = await insertOrganizationMembership(client, orgId, memberId);

    await expect(
      insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId, {
        valid_from: MAY,
        valid_until: MARCH,
        ended_reason: 'removed',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'organization_membership_period_order_check',
    });

    await expect(
      insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId, {
        valid_until: MARCH,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'organization_membership_period_closure_check',
    });

    await expect(
      insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId, {
        valid_until: MARCH,
        ended_reason: 'transferred',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'organization_membership_period_ended_reason_check',
    });
  });

  it('cascades a membership deletion into its periods', async () => {
    const orgId = await insertServiceOrganization(client);
    const memberId = await insertProfile(client);
    const membershipId = await insertOrganizationMembership(client, orgId, memberId);
    await insertOrganizationMembershipPeriod(client, membershipId, orgId, memberId);

    await client.query('DELETE FROM collaboration.organization_membership WHERE id = $1', [
      membershipId,
    ]);

    const { rows } = await client.query<Row>(
      'SELECT count(*)::int AS remaining FROM collaboration.organization_membership_period WHERE membership_id = $1',
      [membershipId],
    );
    expect(rows[0]).toEqual({ remaining: 0 });
  });

  it('answers "who had access to this organization on date X" from the period table, including someone who left and came back', async () => {
    const orgId = await insertServiceOrganization(client);
    const admin = await insertProfile(client);
    const returner = await insertProfile(client);
    const adminMembership = await insertOrganizationMembership(
      client,
      orgId,
      admin,
      'organization_admin',
    );
    const returnerMembership = await insertOrganizationMembership(client, orgId, returner);

    await insertOrganizationMembershipPeriod(client, adminMembership, orgId, admin, {
      role: 'organization_admin',
      valid_from: JANUARY,
    });
    await insertOrganizationMembershipPeriod(client, returnerMembership, orgId, returner, {
      valid_from: JANUARY,
      valid_until: MARCH,
      ended_reason: 'removed',
    });
    await insertOrganizationMembershipPeriod(client, returnerMembership, orgId, returner, {
      valid_from: JULY,
    });

    const accessOn = async (moment: Date): Promise<Row[]> => {
      const { rows } = await client.query<Row>(
        `SELECT profile_id, role FROM collaboration.organization_membership_period
          WHERE organization_id = $1
            AND valid_from <= $2
            AND (valid_until IS NULL OR valid_until > $2)
          ORDER BY role`,
        [orgId, moment],
      );
      return rows;
    };

    expect(await accessOn(JANUARY)).toEqual([
      { profile_id: admin, role: 'organization_admin' },
      { profile_id: returner, role: 'professional' },
    ]);
    expect(await accessOn(MAY)).toEqual([{ profile_id: admin, role: 'organization_admin' }]);
    expect(await accessOn(SEPTEMBER)).toEqual([
      { profile_id: admin, role: 'organization_admin' },
      { profile_id: returner, role: 'professional' },
    ]);
  });

  // --- client_engagement structural checks --------------------------------

  it('constrains client_engagement to the known state and stewardship-policy vocabularies', async () => {
    const gardenId = await insertGarden(client, profileId);

    await expect(
      // `activated_at` set so this fails ONLY the state vocabulary, not also
      // `client_engagement_activated_linkage_check` (an invalid state is
      // never in `('draft', 'revoked')`, so without it both would fire).
      insertClientEngagement(client, gardenId, profileId, {
        state: 'cancelled',
        activated_at: JANUARY,
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'client_engagement_state_check' });

    await expect(
      insertClientEngagement(client, gardenId, profileId, { stewardship_policy: 'commercial' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_engagement_stewardship_policy_check',
    });

    const id = await insertClientEngagement(client, gardenId, profileId);
    const { rows } = await client.query<Row>(
      'SELECT state, stewardship_policy, client_notifications_enabled FROM collaboration.client_engagement WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      state: 'draft',
      stewardship_policy: 'residential',
      client_notifications_enabled: true,
    });
  });

  it('accepts a service organization on a client engagement, or none at all', async () => {
    const gardenId = await insertGarden(client, profileId);
    const orgId = await insertServiceOrganization(client);

    const withOrg = await insertClientEngagement(client, gardenId, profileId, {
      service_organization_id: orgId,
    });
    const withoutOrg = await insertClientEngagement(client, gardenId, profileId);

    const { rows } = await client.query<Row>(
      `SELECT id, service_organization_id FROM collaboration.client_engagement
        WHERE id = ANY($1) ORDER BY id`,
      [[withOrg, withoutOrg].sort()],
    );
    expect(rows.map((r) => r['service_organization_id'])).toEqual(
      [withOrg, withoutOrg].sort().map((id) => (id === withOrg ? orgId : null)),
    );
  });

  // --- client_access_grant structural checks ------------------------------

  it('requires a client_access_grant to name a bound profile, an invited email, or both', async () => {
    const gardenId = await insertGarden(client, profileId);
    const engagementId = await insertClientEngagement(client, gardenId, profileId);

    await expect(insertClientAccessGrant(client, engagementId)).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_access_grant_identity_check',
    });

    await insertClientAccessGrant(client, engagementId, { invited_email: 'client@example.test' });
    const clientProfile = await insertProfile(client);
    await insertClientAccessGrant(client, engagementId, {
      client_profile_id: clientProfile,
      state: 'active',
      granted_at: MARCH,
    });
  });

  it('rejects active access without a bound profile or a grant instant, and normalizes the invited email', async () => {
    const gardenId = await insertGarden(client, profileId);
    const engagementId = await insertClientEngagement(client, gardenId, profileId);
    const clientProfile = await insertProfile(client);

    await expect(
      // `granted_at` set so this fails ONLY the "active requires a bound
      // profile" check, not also the "active requires a grant instant" one.
      insertClientAccessGrant(client, engagementId, {
        state: 'active',
        invited_email: 'x@example.test',
        granted_at: MARCH,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_access_grant_active_requires_profile_check',
    });

    await expect(
      insertClientAccessGrant(client, engagementId, {
        state: 'active',
        client_profile_id: clientProfile,
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_access_grant_active_requires_granted_at_check',
    });

    await expect(
      // `invited_email` set so this fails ONLY the revoked linkage, not also
      // `client_access_grant_identity_check`.
      insertClientAccessGrant(client, engagementId, {
        state: 'revoked',
        invited_email: 'revoked-target@example.test',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_access_grant_revoked_linkage_check',
    });

    await expect(
      insertClientAccessGrant(client, engagementId, { invited_email: 'Client@Example.test' }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'client_access_grant_invited_email_normalized_check',
    });
  });

  it('allows one bound-profile grant per engagement and one pending invited-email target per engagement', async () => {
    const gardenId = await insertGarden(client, profileId);
    const engagementId = await insertClientEngagement(client, gardenId, profileId);
    const clientProfile = await insertProfile(client);
    const email = 'partner@example.test';

    await insertClientAccessGrant(client, engagementId, {
      client_profile_id: clientProfile,
      state: 'active',
      granted_at: MARCH,
    });
    await expect(
      insertClientAccessGrant(client, engagementId, { client_profile_id: clientProfile }),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'client_access_grant_engagement_profile_key',
    });

    await insertClientAccessGrant(client, engagementId, { invited_email: email });
    await expect(
      insertClientAccessGrant(client, engagementId, { invited_email: email }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'client_access_grant_pending_email_key' });

    // A revoked pending grant never blocks a fresh invitation to the same address.
    await client.query(
      `UPDATE collaboration.client_access_grant
          SET state = 'revoked', revoked_at = $2
        WHERE engagement_id = $1 AND invited_email = $3`,
      [engagementId, MARCH, email],
    );
    await insertClientAccessGrant(client, engagementId, { invited_email: email });
  });

  // --- Privileges and rollback --------------------------------------------

  it('grants verdery_application row access to every new table through the schema default privileges', async () => {
    const { rows } = await client.query<Row>(
      `SELECT table_name, grantee, privilege_type
         FROM information_schema.role_table_grants
        WHERE table_schema = 'collaboration'
          AND table_name IN ('service_organization', 'organization_membership',
                              'organization_membership_period', 'garden_assignment',
                              'client_engagement', 'client_access_grant')`,
    );

    const tables = [
      'service_organization',
      'organization_membership',
      'organization_membership_period',
      'garden_assignment',
      'client_engagement',
      'client_access_grant',
    ];
    for (const table of tables) {
      const granted = new Set(
        rows
          .filter((row) => row['table_name'] === table && row['grantee'] === 'verdery_application')
          .map((row) => row['privilege_type']),
      );
      expect(granted).toEqual(new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE']));
    }
    expect(rows.some((row) => row['grantee'] === 'PUBLIC')).toBe(false);
  });

  it('rolls back cleanly, leaving no trace of any of the six new tables', async () => {
    // `count: 15` undoes every migration applied after this one (through
    // 1787800000000_plant-search-extensions.sql —
    // 1786900000000_client-invitation-token.sql in particular ALTERs
    // `client_access_grant` itself and must therefore unwind before this
    // migration's own `DROP TABLE` reaches it; nothing else this file's own
    // assertions below check) first, then this migration itself. Update
    // this count when a later migration is added on top.
    await migrate(databaseUrl, 'down', 15);

    const { rows } = await client.query<Row>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'collaboration'
          AND table_name IN ('service_organization', 'organization_membership',
                              'organization_membership_period', 'garden_assignment',
                              'client_engagement', 'client_access_grant')`,
    );
    expect(rows).toEqual([]);

    // Re-applying must succeed cleanly on top of everything else this
    // database already ran — there is no backfill here to re-exercise, since
    // every one of these tables starts empty.
    await migrate(databaseUrl, 'up');
    const reapplied = await client.query<Row>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'collaboration' AND table_name = 'service_organization'`,
    );
    expect(reapplied.rowCount).toBe(1);
  }, 60_000);
});
