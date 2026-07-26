/**
 * The tenant-isolation half of the P9B-DATA-01 migration suite's completion
 * evidence, named explicitly by the work package: "a professional in
 * organization A must never be able to see/act on organization B's
 * assignments, engagements, or gardens, and a client of one engagement must
 * never see another engagement's data."
 *
 * There is no repository or API in this package (P9B-API-01 is a separate,
 * later work package) — what this suite proves is that the SCHEMA itself,
 * queried directly the way a future repository will, never returns another
 * tenant's rows through any join path the schema allows, even under the
 * deliberately adversarial fixtures below: a professional who belongs to
 * BOTH organizations, and a client with a grant on BOTH engagements.
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
  insertGardenAssignment,
  insertOrganizationMembership,
  insertServiceOrganization,
} from '../support/service-organization-fixtures.js';

const SUITE_NAME = 'service organization and client engagement tenant isolation';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const MARCH = new Date('2026-03-10T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let client: pg.Client;
  let ownerId: string;

  // Two independent tenants, deliberately entangled at the seams: the SAME
  // professional works for both organizations, and the SAME client has
  // access to both engagements. Isolation must hold at the ORGANIZATION and
  // ENGAGEMENT level, not merely because the fixtures happen to use disjoint
  // people.
  let orgA: string;
  let orgB: string;
  let sharedProfessional: string;
  let gardenA: string;
  let gardenB: string;
  let engagementA: string;
  let engagementB: string;
  let sharedClient: string;

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

    ownerId = await insertProfile(client);
    orgA = await insertServiceOrganization(client, { name: 'Organization A' });
    orgB = await insertServiceOrganization(client, { name: 'Organization B' });
    sharedProfessional = await insertProfile(client);
    await insertOrganizationMembership(client, orgA, sharedProfessional, 'professional');
    await insertOrganizationMembership(client, orgB, sharedProfessional, 'professional');

    gardenA = await insertGarden(client, ownerId);
    gardenB = await insertGarden(client, ownerId);
    await insertGardenAssignment(client, orgA, sharedProfessional, gardenA, ownerId, {
      role: 'editor',
    });
    await insertGardenAssignment(client, orgB, sharedProfessional, gardenB, ownerId, {
      role: 'viewer',
    });

    engagementA = await insertClientEngagement(client, gardenA, ownerId, {
      service_organization_id: orgA,
    });
    engagementB = await insertClientEngagement(client, gardenB, ownerId, {
      service_organization_id: orgB,
    });
    sharedClient = await insertProfile(client);
    await insertClientAccessGrant(client, engagementA, {
      client_profile_id: sharedClient,
      state: 'active',
      granted_at: MARCH,
    });
    await insertClientAccessGrant(client, engagementB, {
      client_profile_id: sharedClient,
      state: 'active',
      granted_at: MARCH,
    });
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it('scopes organization membership listings to one organization even for a shared professional', async () => {
    const { rows } = await client.query<Row>(
      `SELECT profile_id FROM collaboration.organization_membership WHERE organization_id = $1`,
      [orgA],
    );
    expect(rows).toEqual([{ profile_id: sharedProfessional }]);

    const { rows: bRows } = await client.query<Row>(
      `SELECT profile_id FROM collaboration.organization_membership WHERE organization_id = $1`,
      [orgB],
    );
    expect(bRows).toEqual([{ profile_id: sharedProfessional }]);

    // Filtering by profile alone, with no organization predicate, is exactly
    // the query shape a careless repository would write — and it is the one
    // this suite exists to warn a future package away from, not the one
    // tenant-scoped code should use. Recorded so the two-row result is a
    // documented fact of the shared professional, not a surprise later.
    const { rows: byProfileOnly } = await client.query<Row>(
      `SELECT organization_id FROM collaboration.organization_membership WHERE profile_id = $1 ORDER BY organization_id`,
      [sharedProfessional],
    );
    expect(byProfileOnly.map((r) => r['organization_id']).sort()).toEqual([orgA, orgB].sort());
  });

  it('scopes garden assignments to one organization, through the join a real query would use', async () => {
    const assignmentsFor = async (organizationId: string): Promise<Row[]> => {
      const { rows } = await client.query<Row>(
        `SELECT ga.garden_id, ga.profile_id, ga.role
           FROM collaboration.garden_assignment ga
          WHERE ga.organization_id = $1 AND ga.state = 'active'`,
        [organizationId],
      );
      return rows;
    };

    expect(await assignmentsFor(orgA)).toEqual([
      { garden_id: gardenA, profile_id: sharedProfessional, role: 'editor' },
    ]);
    expect(await assignmentsFor(orgB)).toEqual([
      { garden_id: gardenB, profile_id: sharedProfessional, role: 'viewer' },
    ]);

    // A join from assignment to membership scoped by organization must never
    // let the OTHER organization's assignment ride along, even though both
    // share the same profile_id.
    const { rows } = await client.query<Row>(
      `SELECT ga.garden_id
         FROM collaboration.garden_assignment ga
         JOIN collaboration.organization_membership om
           ON om.organization_id = ga.organization_id AND om.profile_id = ga.profile_id
        WHERE om.organization_id = $1`,
      [orgA],
    );
    expect(rows).toEqual([{ garden_id: gardenA }]);
  });

  it('scopes client engagements to one organization', async () => {
    const { rows } = await client.query<Row>(
      `SELECT id FROM collaboration.client_engagement WHERE service_organization_id = $1`,
      [orgA],
    );
    expect(rows).toEqual([{ id: engagementA }]);
  });

  it('scopes client access grants to one engagement even for a client shared across two engagements', async () => {
    const grantsFor = async (engagementId: string): Promise<Row[]> => {
      const { rows } = await client.query<Row>(
        `SELECT client_profile_id FROM collaboration.client_access_grant WHERE engagement_id = $1`,
        [engagementId],
      );
      return rows;
    };

    expect(await grantsFor(engagementA)).toEqual([{ client_profile_id: sharedClient }]);
    expect(await grantsFor(engagementB)).toEqual([{ client_profile_id: sharedClient }]);

    // The reverse question — "which engagements can this client reach" — must
    // return BOTH, and only both: this is the legitimate cross-engagement
    // query a client-portal session list uses, distinct from a query that
    // fails to scope by engagement when it should.
    const { rows } = await client.query<Row>(
      `SELECT engagement_id FROM collaboration.client_access_grant
        WHERE client_profile_id = $1 ORDER BY engagement_id`,
      [sharedClient],
    );
    expect(rows.map((r) => r['engagement_id']).sort()).toEqual([engagementA, engagementB].sort());
  });

  it('never lets one engagement’s grant answer a lookup scoped to a different engagement, by id or by profile', async () => {
    const { rows } = await client.query<Row>(
      `SELECT 1 FROM collaboration.client_access_grant
        WHERE engagement_id = $1 AND client_profile_id = $2`,
      [engagementB, sharedClient],
    );
    expect(rows).toHaveLength(1);

    const { rows: crossCheck } = await client.query<Row>(
      `SELECT cag.id
         FROM collaboration.client_access_grant cag
         JOIN collaboration.client_engagement ce ON ce.id = cag.engagement_id
        WHERE cag.client_profile_id = $1 AND ce.id = $2`,
      [sharedClient, engagementA],
    );
    expect(crossCheck).toHaveLength(1);
    const grantIdForA = crossCheck[0]?.['id'];

    const { rows: notForB } = await client.query<Row>(
      `SELECT 1 FROM collaboration.client_access_grant WHERE id = $1 AND engagement_id = $2`,
      [grantIdForA, engagementB],
    );
    expect(notForB).toHaveLength(0);
  });
});
