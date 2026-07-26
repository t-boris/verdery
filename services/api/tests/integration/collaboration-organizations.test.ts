/**
 * Full-stack integration tests for service-organization lifecycle and
 * membership administration (P9B-API-01): `CreateServiceOrganization`,
 * `ListOrganizations`, `GetOrganization`, `ListOrganizationMembers`,
 * `AddOrganizationMember`, `ChangeOrganizationMemberRole`,
 * `RemoveOrganizationMember` — including the last-admin lock proven under
 * genuine PostgreSQL concurrency, the same proof discipline
 * `collaboration-membership.test.ts` already applies to the analogous
 * last-owner lock.
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  AddOrganizationMember,
  ChangeOrganizationMemberRole,
  CreateServiceOrganization,
  GetOrganization,
  KyselyCollaborationUnitOfWork,
  KyselyOrganizationMembershipRepository,
  KyselyOrganizationRepository,
  ListOrganizationMembers,
  ListOrganizations,
  OrganizationAuthorization,
  RemoveOrganizationMember,
} from '../../src/modules/collaboration/public.js';
import { KyselyProfileRepository } from '../../src/modules/identity-access/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import {
  ConflictError,
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
} from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activeAdminCount,
  fixedClock,
  insertOrganizationMembership,
  insertProfile,
} from '../support/organization-integration-harness.js';

const SUITE_NAME = 'collaboration organization lifecycle integration';
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

  function authorization(): OrganizationAuthorization {
    return new OrganizationAuthorization(new KyselyOrganizationMembershipRepository(db));
  }

  function createOrganizationCommand(now: Date): CreateServiceOrganization {
    return new CreateServiceOrganization(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );
  }

  function addMemberCommand(now: Date): AddOrganizationMember {
    return new AddOrganizationMember(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      authorization(),
      new KyselyProfileRepository(db),
      fixedClock(now),
    );
  }

  function changeRoleCommand(now: Date): ChangeOrganizationMemberRole {
    return new ChangeOrganizationMemberRole(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      authorization(),
      fixedClock(now),
    );
  }

  function removeMemberCommand(now: Date): RemoveOrganizationMember {
    return new RemoveOrganizationMember(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      authorization(),
      fixedClock(now),
    );
  }

  // --- CreateServiceOrganization -----------------------------------

  it('creates the organization AND its first admin membership in one transaction', async () => {
    const profileId = await insertProfile(db);

    const organization = await createOrganizationCommand(JANUARY).execute(
      profileId,
      'Green Thumb Gardening',
      randomUUID(),
    );

    expect(organization.name).toBe('Green Thumb Gardening');
    expect(organization.callerRole).toBe('organizationAdmin');
    expect(await activeAdminCount(db, organization.id)).toBe(1);

    const membership = await db
      .selectFrom('collaboration.organization_membership')
      .selectAll()
      .where('organization_id', '=', organization.id)
      .where('profile_id', '=', profileId)
      .executeTakeFirstOrThrow();
    expect(membership.role).toBe('organization_admin');
    expect(membership.state).toBe('active');

    const period = await db
      .selectFrom('collaboration.organization_membership_period')
      .selectAll()
      .where('membership_id', '=', membership.id)
      .executeTakeFirstOrThrow();
    expect(period.role).toBe('organization_admin');
    expect(period.valid_until).toBeNull();
  });

  it('rejects a blank organization name', async () => {
    const profileId = await insertProfile(db);

    await expect(
      createOrganizationCommand(JANUARY).execute(profileId, '   ', randomUUID()),
    ).rejects.toMatchObject({ code: 'request.invalid' });
  });

  // --- GetOrganization / ListOrganizations --------------------------

  it('lets any active member GET the organization, and conceals it from a non-member as not-found', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Solo Gardener Co',
      randomUUID(),
    );
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalId,
      'professional',
      JANUARY,
    );

    const getOrganization = new GetOrganization(
      new KyselyOrganizationRepository(db),
      authorization(),
    );

    const asAdmin = await getOrganization.execute(organization.id, adminId);
    expect(asAdmin.callerRole).toBe('organizationAdmin');
    const asProfessional = await getOrganization.execute(organization.id, professionalId);
    expect(asProfessional.callerRole).toBe('professional');

    const outsiderId = await insertProfile(db);
    await expect(getOrganization.execute(organization.id, outsiderId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('lists only the organizations the caller has ACTIVE membership on', async () => {
    const profileId = await insertProfile(db);
    const own = await createOrganizationCommand(JANUARY).execute(profileId, 'Mine', randomUUID());
    const otherAdminId = await insertProfile(db);
    await createOrganizationCommand(JANUARY).execute(otherAdminId, 'Not Mine', randomUUID());

    const listOrganizations = new ListOrganizations(new KyselyOrganizationRepository(db));
    const result = await listOrganizations.execute(profileId);

    expect(result.items.map((item) => item.id)).toEqual([own.id]);
  });

  // --- ListOrganizationMembers ---------------------------------------

  it('lists active members for admin AND professional alike, excluding a removed member', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Team Co',
      randomUUID(),
    );
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalId,
      'professional',
      JANUARY,
    );
    const removedId = await insertProfile(db);
    const removedMembershipId = await insertOrganizationMembership(
      db,
      organization.id,
      removedId,
      'professional',
      JANUARY,
    );
    await db
      .updateTable('collaboration.organization_membership')
      .set({ state: 'removed' })
      .where('id', '=', removedMembershipId)
      .execute();

    const listMembers = new ListOrganizationMembers(
      new KyselyOrganizationMembershipRepository(db),
      authorization(),
    );

    for (const caller of [adminId, professionalId]) {
      const result = await listMembers.execute(organization.id, caller);
      const profileIds = result.items.map((item) => item.profileId).sort();
      expect(profileIds).toEqual([adminId, professionalId].sort());
    }
  });

  // --- AddOrganizationMember -------------------------------------------

  it('adds an existing profile as a member, admin-only', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Add Member Co',
      randomUUID(),
    );
    const targetId = await insertProfile(db);

    const added = await addMemberCommand(MARCH).execute(
      organization.id,
      targetId,
      'professional',
      adminId,
      randomUUID(),
    );

    expect(added.role).toBe('professional');
    expect(added.state).toBe('active');
  });

  it('rejects a non-admin attempting to add a member', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'No Access Co',
      randomUUID(),
    );
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalId,
      'professional',
      JANUARY,
    );
    const targetId = await insertProfile(db);

    await expect(
      addMemberCommand(MARCH).execute(
        organization.id,
        targetId,
        'professional',
        professionalId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects adding a profile that does not exist', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Ghost Profile Co',
      randomUUID(),
    );

    await expect(
      addMemberCommand(MARCH).execute(
        organization.id,
        randomUUID(),
        'professional',
        adminId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'organization.membership.profile_not_found' });
  });

  it('refuses to add a profile who already has a membership record on this organization', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Duplicate Co',
      randomUUID(),
    );

    await expect(
      addMemberCommand(MARCH).execute(
        organization.id,
        adminId,
        'professional',
        adminId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // --- ChangeOrganizationMemberRole -------------------------------------

  it('promotes a professional to admin, and demotes an admin back to professional while another admin remains', async () => {
    const adminAId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminAId,
      'Promote Co',
      randomUUID(),
    );
    const memberId = await insertProfile(db);
    await insertOrganizationMembership(db, organization.id, memberId, 'professional', JANUARY);

    const promoted = await changeRoleCommand(MARCH).execute(
      organization.id,
      memberId,
      adminAId,
      'organization_admin',
      randomUUID(),
    );
    expect(promoted.role).toBe('organizationAdmin');
    expect(await activeAdminCount(db, organization.id)).toBe(2);

    const demoted = await changeRoleCommand(MARCH).execute(
      organization.id,
      memberId,
      adminAId,
      'professional',
      randomUUID(),
    );
    expect(demoted.role).toBe('professional');
    expect(await activeAdminCount(db, organization.id)).toBe(1);
  });

  it('the last-admin lock: demoting the organization sole admin is refused', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Sole Admin Co',
      randomUUID(),
    );

    await expect(
      changeRoleCommand(MARCH).execute(
        organization.id,
        adminId,
        adminId,
        'professional',
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'organization.membership.last_admin_required' });

    expect(await activeAdminCount(db, organization.id)).toBe(1);
  });

  it('rejects a non-admin attempting to change a role', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'No Role Change Co',
      randomUUID(),
    );
    const professionalAId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalAId,
      'professional',
      JANUARY,
    );
    const professionalBId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalBId,
      'professional',
      JANUARY,
    );

    await expect(
      changeRoleCommand(MARCH).execute(
        organization.id,
        professionalBId,
        professionalAId,
        'organization_admin',
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // --- RemoveOrganizationMember -----------------------------------------

  it('lets any member remove THEMSELVES without the admin-only capability', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Self Leave Co',
      randomUUID(),
    );
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalId,
      'professional',
      JANUARY,
    );

    const removed = await removeMemberCommand(MARCH).execute(
      organization.id,
      professionalId,
      professionalId,
      randomUUID(),
    );

    expect(removed.state).toBe('removed');
  });

  it('lets an admin remove another member, and denies a non-admin the same action', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Remove Other Co',
      randomUUID(),
    );
    const professionalAId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalAId,
      'professional',
      JANUARY,
    );
    const professionalBId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      professionalBId,
      'professional',
      JANUARY,
    );

    await expect(
      removeMemberCommand(MARCH).execute(
        organization.id,
        professionalBId,
        professionalAId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const removed = await removeMemberCommand(MARCH).execute(
      organization.id,
      professionalBId,
      adminId,
      randomUUID(),
    );
    expect(removed.state).toBe('removed');
  });

  it('the last-admin lock: a sole admin cannot remove themselves', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Sole Leave Co',
      randomUUID(),
    );

    await expect(
      removeMemberCommand(MARCH).execute(organization.id, adminId, adminId, randomUUID()),
    ).rejects.toMatchObject({ code: 'organization.membership.last_admin_required' });

    expect(await activeAdminCount(db, organization.id)).toBe(1);
  });

  it('the last-admin lock under GENUINE concurrency: two admins racing to remove themselves — exactly one succeeds', async () => {
    const adminAId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminAId,
      'Concurrent Co',
      randomUUID(),
    );
    const adminBId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organization.id,
      adminBId,
      'organization_admin',
      JANUARY,
    );

    const results = await Promise.allSettled([
      removeMemberCommand(MARCH).execute(organization.id, adminAId, adminAId, randomUUID()),
      removeMemberCommand(MARCH).execute(organization.id, adminBId, adminBId, randomUUID()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'organization.membership.last_admin_required',
    });

    expect(await activeAdminCount(db, organization.id)).toBe(1);
  });

  it('conceals a target with no active membership as not-found', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'No Target Co',
      randomUUID(),
    );

    await expect(
      removeMemberCommand(MARCH).execute(organization.id, randomUUID(), adminId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('DomainRuleViolatedError instances carry the expected error category for the last-admin invariant', async () => {
    const adminId = await insertProfile(db);
    const organization = await createOrganizationCommand(JANUARY).execute(
      adminId,
      'Category Check Co',
      randomUUID(),
    );

    const error = await removeMemberCommand(MARCH)
      .execute(organization.id, adminId, adminId, randomUUID())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainRuleViolatedError);
  });
});
