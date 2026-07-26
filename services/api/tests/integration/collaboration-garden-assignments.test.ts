/**
 * Full-stack integration tests for garden-assignment lifecycle (P9B-API-01):
 * `CreateGardenAssignment`, `EndGardenAssignment`, `RevokeGardenAssignment`,
 * `ListGardenAssignmentsForOrganization`, `ListGardenAssignmentsForGarden` —
 * the ONE place organization boundaries and garden boundaries meet.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "7. Service Organizations and Assignments".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  CreateGardenAssignment,
  EndGardenAssignment,
  KyselyCollaborationUnitOfWork,
  KyselyGardenAssignmentRepository,
  KyselyOrganizationMembershipRepository,
  ListGardenAssignmentsForGarden,
  ListGardenAssignmentsForOrganization,
  OrganizationAuthorization,
  RevokeGardenAssignment,
} from '../../src/modules/collaboration/public.js';
import {
  GardenAuthorization,
  KyselyGardenRepository,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import {
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
} from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertMembership } from '../support/collaboration-integration-harness.js';
import {
  activeAssignmentCount,
  fixedClock,
  insertGardenAssignment,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
} from '../support/organization-integration-harness.js';

const SUITE_NAME = 'collaboration garden-assignment lifecycle integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

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

    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  });

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function organizationAuthorization(): OrganizationAuthorization {
    return new OrganizationAuthorization(new KyselyOrganizationMembershipRepository(db));
  }

  function gardenAuthorization(): GardenAuthorization {
    return new GardenAuthorization(new KyselyMembershipRepository(db));
  }

  function createAssignmentCommand(now: Date): CreateGardenAssignment {
    return new CreateGardenAssignment(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      new KyselyGardenRepository(db),
      fixedClock(now),
    );
  }

  function endAssignmentCommand(now: Date): EndGardenAssignment {
    return new EndGardenAssignment(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      fixedClock(now),
    );
  }

  function revokeAssignmentCommand(now: Date): RevokeGardenAssignment {
    return new RevokeGardenAssignment(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      fixedClock(now),
    );
  }

  async function seedOrgWithAdminAndMember() {
    const adminId = await insertProfile(db);
    const organizationId = await insertOrganization(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    return { adminId, organizationId, professionalId };
  }

  // --- CreateGardenAssignment -------------------------------------------

  it('an organization admin assigns one of their own organization members to an existing garden', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    const assignment = await createAssignmentCommand(MARCH).execute(
      organizationId,
      { profileId: professionalId, gardenId, role: 'editor' },
      adminId,
      randomUUID(),
    );

    expect(assignment.state).toBe('active');
    expect(assignment.profileId).toBe(professionalId);
    expect(assignment.gardenId).toBe(gardenId);
    expect(await activeAssignmentCount(db, gardenId, professionalId)).toBe(1);
  });

  it('is a free-standing grant: no client engagement needs to exist first', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    // No `collaboration.client_engagement` row exists at all for this
    // (organization, garden) pair — the assignment must still succeed.
    const engagementCount = await db
      .selectFrom('collaboration.client_engagement')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirst();
    expect(Number(engagementCount?.count ?? 0)).toBe(0);

    await expect(
      createAssignmentCommand(MARCH).execute(
        organizationId,
        { profileId: professionalId, gardenId, role: 'viewer' },
        adminId,
        randomUUID(),
      ),
    ).resolves.toMatchObject({ state: 'active' });
  });

  it('rejects a non-admin attempting to create an assignment', async () => {
    const { organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    await expect(
      createAssignmentCommand(MARCH).execute(
        organizationId,
        { profileId: professionalId, gardenId, role: 'editor' },
        professionalId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects assigning a profile who is not an active member of THIS organization', async () => {
    const { adminId, organizationId } = await seedOrgWithAdminAndMember();
    const outsiderId = await insertProfile(db);
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    await expect(
      createAssignmentCommand(MARCH).execute(
        organizationId,
        { profileId: outsiderId, gardenId, role: 'editor' },
        adminId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'organization.assignment.assignee_not_member' });
  });

  it('rejects assigning to a garden id that does not exist', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();

    await expect(
      createAssignmentCommand(MARCH).execute(
        organizationId,
        { profileId: professionalId, gardenId: randomUUID(), role: 'editor' },
        adminId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'garden.not_found' });
  });

  it('refuses a second simultaneous active assignment for the same (garden, profile)', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    await createAssignmentCommand(MARCH).execute(
      organizationId,
      { profileId: professionalId, gardenId, role: 'editor' },
      adminId,
      randomUUID(),
    );

    await expect(
      createAssignmentCommand(MARCH).execute(
        organizationId,
        { profileId: professionalId, gardenId, role: 'viewer' },
        adminId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'organization.assignment.already_active' });

    expect(await activeAssignmentCount(db, gardenId, professionalId)).toBe(1);
  });

  // --- EndGardenAssignment / RevokeGardenAssignment ---------------------

  it('ends an active assignment, idempotently', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    const assignmentId = await insertGardenAssignment(
      db,
      organizationId,
      professionalId,
      gardenId,
      adminId,
    );

    const ended = await endAssignmentCommand(MARCH).execute(
      organizationId,
      assignmentId,
      adminId,
      randomUUID(),
    );
    expect(ended.state).toBe('ended');

    // Idempotent no-op replay under a FRESH idempotency key.
    const endedAgain = await endAssignmentCommand(MARCH).execute(
      organizationId,
      assignmentId,
      adminId,
      randomUUID(),
    );
    expect(endedAgain.state).toBe('ended');
  });

  it('refuses to end an assignment already revoked — the other terminal state', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    const assignmentId = await insertGardenAssignment(
      db,
      organizationId,
      professionalId,
      gardenId,
      adminId,
    );
    await revokeAssignmentCommand(MARCH).execute(
      organizationId,
      assignmentId,
      adminId,
      randomUUID(),
    );

    await expect(
      endAssignmentCommand(MARCH).execute(organizationId, assignmentId, adminId, randomUUID()),
    ).rejects.toMatchObject({ code: 'organization.assignment.invalid_transition' });
  });

  it('rejects a non-admin attempting to end an assignment', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    const assignmentId = await insertGardenAssignment(
      db,
      organizationId,
      professionalId,
      gardenId,
      adminId,
    );

    await expect(
      endAssignmentCommand(MARCH).execute(
        organizationId,
        assignmentId,
        professionalId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an organization admin cannot end or revoke a DIFFERENT organization's assignment", async () => {
    const orgA = await seedOrgWithAdminAndMember();
    const orgB = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    const assignmentId = await insertGardenAssignment(
      db,
      orgA.organizationId,
      orgA.professionalId,
      gardenId,
      orgA.adminId,
    );

    await expect(
      endAssignmentCommand(MARCH).execute(
        orgB.organizationId,
        assignmentId,
        orgB.adminId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      revokeAssignmentCommand(MARCH).execute(
        orgB.organizationId,
        assignmentId,
        orgB.adminId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Untouched: still active.
    expect(await activeAssignmentCount(db, gardenId, orgA.professionalId)).toBe(1);
  });

  it('DomainRuleViolatedError is thrown for an invalid transition attempt', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    const assignmentId = await insertGardenAssignment(
      db,
      organizationId,
      professionalId,
      gardenId,
      adminId,
    );
    await endAssignmentCommand(MARCH).execute(organizationId, assignmentId, adminId, randomUUID());

    const error = await revokeAssignmentCommand(MARCH)
      .execute(organizationId, assignmentId, adminId, randomUUID())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainRuleViolatedError);
  });

  // --- ListGardenAssignmentsForOrganization / ListGardenAssignmentsForGarden

  it("lists an organization's active assignments across every garden, visible to any active member", async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenOneId = await insertGarden(db, gardenOwnerId);
    const gardenTwoId = await insertGarden(db, gardenOwnerId);
    await insertGardenAssignment(db, organizationId, professionalId, gardenOneId, adminId);
    await insertGardenAssignment(db, organizationId, professionalId, gardenTwoId, adminId);

    const listForOrganization = new ListGardenAssignmentsForOrganization(
      new KyselyGardenAssignmentRepository(db),
      organizationAuthorization(),
    );

    const result = await listForOrganization.execute(organizationId, professionalId);
    expect(result.items.map((item) => item.gardenId).sort()).toEqual(
      [gardenOneId, gardenTwoId].sort(),
    );
  });

  it("lists a garden's active assignments, visible to any garden role (viewGarden)", async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndMember();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    await insertMembership(db, gardenId, gardenOwnerId, 'owner', JANUARY);
    const viewerId = await insertProfile(db);
    await insertMembership(db, gardenId, viewerId, 'viewer', JANUARY);
    await insertGardenAssignment(db, organizationId, professionalId, gardenId, adminId);

    const listForGarden = new ListGardenAssignmentsForGarden(
      new KyselyGardenAssignmentRepository(db),
      gardenAuthorization(),
    );

    for (const caller of [gardenOwnerId, viewerId]) {
      const result = await listForGarden.execute(gardenId, caller);
      expect(result.items.map((item) => item.profileId)).toEqual([professionalId]);
    }
  });
});
