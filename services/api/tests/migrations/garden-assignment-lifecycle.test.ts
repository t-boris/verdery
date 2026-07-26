/**
 * The garden-assignment half of the P9B-DATA-01 migration suite's completion
 * evidence: "assignment lifecycle" tests. `collaboration.garden_assignment`
 * is the ONLY mechanism through which organization membership becomes garden
 * access (ADR-0012), so this suite proves both what the schema enforces
 * about that mechanism and, honestly, what it does not — the same
 * does-not-stop-it-but-here-is-what-must pairing
 * `collaboration-assignment-and-last-owner.test.ts` established for demoting
 * a last owner.
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
  insertGardenAssignment,
  insertOrganizationMembership,
  insertServiceOrganization,
} from '../support/service-organization-fixtures.js';

const SUITE_NAME = 'garden assignment lifecycle migration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');
const MAY = new Date('2026-05-10T09:00:00Z');
const JULY = new Date('2026-07-10T09:00:00Z');

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

  async function organizationWithProfessional(): Promise<{
    orgId: string;
    professionalId: string;
  }> {
    const orgId = await insertServiceOrganization(client);
    const professionalId = await insertProfile(client);
    await insertOrganizationMembership(client, orgId, professionalId, 'professional');
    return { orgId, professionalId };
  }

  it('grants a garden-shaped role, never ownership: the client owns the garden, not the assignment', async () => {
    const { orgId, professionalId } = await organizationWithProfessional();
    const gardenId = await insertGarden(client, profileId);

    await insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
      role: 'editor',
    });
    await insertGardenAssignment(client, orgId, await insertProfile(client), gardenId, profileId, {
      role: 'viewer',
    });
    await expect(
      insertGardenAssignment(client, orgId, await insertProfile(client), gardenId, profileId, {
        role: 'owner',
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'garden_assignment_role_check' });
  });

  it('rejects an unknown state, and ties open/closed to the presence of an end instant', async () => {
    const { orgId, professionalId } = await organizationWithProfessional();
    const gardenId = await insertGarden(client, profileId);

    await expect(
      // `valid_from`/`valid_until` set consistently so this fails ONLY the
      // state vocabulary, not also `garden_assignment_closure_check` or
      // `garden_assignment_order_check`.
      insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
        state: 'paused',
        valid_from: JANUARY,
        valid_until: MARCH,
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'garden_assignment_state_check' });

    // An 'active' row with an end instant, or an 'ended' row with none, is a
    // half-written close either way. `valid_from` set on the first case so
    // it fails ONLY the closure equivalence, not also the order check.
    await expect(
      insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
        valid_from: JANUARY,
        valid_until: MARCH,
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'garden_assignment_closure_check' });
    await expect(
      insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
        state: 'ended',
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'garden_assignment_closure_check' });

    await expect(
      insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
        valid_from: MAY,
        valid_until: MARCH,
        state: 'ended',
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'garden_assignment_order_check' });
  });

  it('cannot assign the same professional to the same garden twice while the first assignment is active', async () => {
    const { orgId, professionalId } = await organizationWithProfessional();
    const gardenId = await insertGarden(client, profileId);

    await insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
      valid_from: JANUARY,
    });
    await expect(
      insertGardenAssignment(client, orgId, professionalId, gardenId, profileId),
    ).rejects.toMatchObject({ code: '23505', constraint: 'garden_assignment_active_key' });

    // Ending the first assignment frees the slot for a genuine reassignment.
    await client.query(
      `UPDATE collaboration.garden_assignment
          SET state = 'ended', valid_until = $2
        WHERE organization_id = $1 AND profile_id = $3 AND garden_id = $4 AND state = 'active'`,
      [orgId, MARCH, professionalId, gardenId],
    );
    const reassignmentId = await insertGardenAssignment(
      client,
      orgId,
      professionalId,
      gardenId,
      profileId,
      { valid_from: MARCH },
    );

    const { rows } = await client.query<Row>(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE state = 'active'))::int AS active
         FROM collaboration.garden_assignment
        WHERE organization_id = $1 AND profile_id = $2 AND garden_id = $3`,
      [orgId, professionalId, gardenId],
    );
    expect(rows[0]).toEqual({ total: 2, active: 1 });

    const { rows: current } = await client.query<Row>(
      'SELECT id FROM collaboration.garden_assignment WHERE state = $1 AND garden_id = $2',
      ['active', gardenId],
    );
    expect(current[0]?.['id']).toBe(reassignmentId);
  });

  it('answers "was this professional assigned to this garden on date X" from the assignment rows themselves', async () => {
    const { orgId, professionalId } = await organizationWithProfessional();
    const gardenId = await insertGarden(client, profileId);

    await insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
      valid_from: JANUARY,
      valid_until: MARCH,
      state: 'ended',
    });
    await insertGardenAssignment(client, orgId, professionalId, gardenId, profileId, {
      valid_from: JULY,
    });

    const assignedOn = async (moment: Date): Promise<boolean> => {
      const { rows } = await client.query<Row>(
        `SELECT 1 FROM collaboration.garden_assignment
          WHERE organization_id = $1 AND profile_id = $2 AND garden_id = $3
            AND valid_from <= $4 AND (valid_until IS NULL OR valid_until > $4)`,
        [orgId, professionalId, gardenId, moment],
      );
      return rows.length > 0;
    };

    expect(await assignedOn(JANUARY)).toBe(true);
    expect(await assignedOn(MAY)).toBe(false);
    expect(await assignedOn(JULY)).toBe(true);
  });

  it('records who created the assignment, distinct from who holds it', async () => {
    const { orgId, professionalId } = await organizationWithProfessional();
    const gardenId = await insertGarden(client, profileId);
    const assignmentId = await insertGardenAssignment(
      client,
      orgId,
      professionalId,
      gardenId,
      profileId,
    );

    const { rows } = await client.query<Row>(
      'SELECT profile_id, created_by_profile_id FROM collaboration.garden_assignment WHERE id = $1',
      [assignmentId],
    );
    expect(rows[0]).toEqual({ profile_id: professionalId, created_by_profile_id: profileId });
  });

  it('survives a garden purge: no foreign key ties the assignment row to gardens_mapping.garden', async () => {
    const { orgId, professionalId } = await organizationWithProfessional();
    const gardenId = await insertGarden(client, profileId);
    const assignmentId = await insertGardenAssignment(
      client,
      orgId,
      professionalId,
      gardenId,
      profileId,
    );

    await client.query('DELETE FROM gardens_mapping.garden WHERE id = $1', [gardenId]);

    const { rows } = await client.query<Row>(
      'SELECT garden_id FROM collaboration.garden_assignment WHERE id = $1',
      [assignmentId],
    );
    expect(rows[0]).toEqual({ garden_id: gardenId });
  });

  it('does NOT stop a closed assignment from being reopened directly: transition sequencing is application-enforced', async () => {
    const { orgId, professionalId } = await organizationWithProfessional();
    const gardenId = await insertGarden(client, profileId);
    const assignmentId = await insertGardenAssignment(
      client,
      orgId,
      professionalId,
      gardenId,
      profileId,
      {
        state: 'ended',
        valid_from: JANUARY,
        valid_until: MARCH,
      },
    );

    // No trigger compares this row's OLD state to its NEW one, so a CHECK
    // that only ever sees the row being written cannot reject "reopening" an
    // assignment that was already closed — recorded here so nobody reads the
    // closure CHECK and assumes it also guards the SEQUENCE of states.
    await client.query(
      `UPDATE collaboration.garden_assignment SET state = 'active', valid_until = NULL WHERE id = $1`,
      [assignmentId],
    );

    const { rows } = await client.query<Row>(
      'SELECT state, valid_until FROM collaboration.garden_assignment WHERE id = $1',
      [assignmentId],
    );
    expect(rows[0]).toEqual({ state: 'active', valid_until: null });
  });
});
