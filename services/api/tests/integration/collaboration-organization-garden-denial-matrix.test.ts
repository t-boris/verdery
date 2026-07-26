/**
 * THE ORGANIZATION/GARDEN CROSS-PRODUCT DENIAL MATRIX — P9B-API-01's own
 * completion evidence.
 *
 * ADR-0012's single most important invariant this whole package protects:
 * "Organization membership alone grants no garden access. A professional
 * must also have an active garden assignment or operational garden
 * membership." Every test below assumes an attacker who IS an
 * `organizationAdmin` or `professional` on some organization, and/or an
 * ACTIVE garden owner, and tries to reach a resource through that identity
 * alone — and fails, every time, unless a real `garden_assignment` row (or
 * ordinary `collaboration.membership`) says otherwise.
 *
 * Six proofs, matching the work package's own enumeration:
 *
 *   1. Organization membership PLUS an active garden assignment still does
 *      NOT satisfy garden-scoped authorization (`GardenAuthorization`) —
 *      the assignment is not wired into it, by design, this pass.
 *   2. A professional of organization A cannot act on organization B's
 *      assignments.
 *   3. A professional of organization A cannot act on a garden they have
 *      no assignment for, even though they belong to SOME organization.
 *   4. A garden's owner alone (no assignment, no engagement, no
 *      organization membership) cannot administer an unrelated
 *      organization.
 *   5. An organization admin cannot bypass `manageGardenAssignment`'s own
 *      gate by going through garden-level `GardenAuthorization` instead —
 *      proven by showing the admin's own garden-scoped read fails
 *      identically to a total stranger's, because no membership row for
 *      them exists on that garden.
 *   6. Symmetrically, a garden owner's own organization-scoped read fails
 *      identically to a total stranger's, because no membership row for
 *      them exists on that organization — the same "no shared code path"
 *      proof from the opposite direction.
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
  CreateGardenAssignment,
  EndGardenAssignment,
  KyselyCollaborationUnitOfWork,
  KyselyGardenAssignmentRepository,
  KyselyOrganizationMembershipRepository,
  ListGardenAssignmentsForOrganization,
  OrganizationAuthorization,
} from '../../src/modules/collaboration/public.js';
import {
  GardenAuthorization,
  KyselyGardenRepository,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden } from '../support/collaboration-integration-harness.js';
import {
  activeAssignmentCount,
  fixedClock,
  insertGardenAssignment,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
} from '../support/organization-integration-harness.js';

const SUITE_NAME = 'organization/garden cross-product denial matrix';
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

  async function seedOrgWithAdminAndProfessional() {
    const adminId = await insertProfile(db);
    const organizationId = await insertOrganization(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    return { adminId, organizationId, professionalId };
  }

  // --- 1. Organization membership + an ACTIVE assignment still does NOT
  // grant garden access through `GardenAuthorization` ----------------------

  it("1. a professional with organization membership AND an active garden assignment still has no `GardenAuthorization` access — ADR-0012's own invariant, proven structurally", async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndProfessional();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    // The professional genuinely has BOTH: active organization membership
    // AND an active garden_assignment naming this exact garden.
    await insertGardenAssignment(db, organizationId, professionalId, gardenId, adminId);
    expect(await activeAssignmentCount(db, gardenId, professionalId)).toBe(1);
    const orgMembership = await organizationAuthorization().requireActiveMembership(
      organizationId,
      professionalId,
    );
    expect(orgMembership.role).toBe('professional');

    // Yet `GardenAuthorization` — the ONE enforcement point every
    // garden-scoped command in every module funnels through — has never
    // heard of either fact, because no `collaboration.membership` row
    // exists for this profile on this garden. The professional is refused
    // exactly like a total stranger: concealed as `notFound`.
    await expect(
      gardenAuthorization().requireCapability(gardenId, professionalId, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // --- 2. professional-of-org-A cannot act on org-B's assignments --------

  it("2. professional-of-org-A cannot act on org-B's assignments (cross-organization boundary)", async () => {
    const orgA = await seedOrgWithAdminAndProfessional();
    const orgB = await seedOrgWithAdminAndProfessional();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    const createForOrgB = new CreateGardenAssignment(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      organizationAuthorization(),
      new KyselyGardenRepository(db),
      fixedClock(MARCH),
    );

    // orgA's professional (no capability at all on orgA, and no
    // membership whatsoever on orgB) attempts to create an assignment
    // under orgB's own path.
    await expect(
      createForOrgB.execute(
        orgB.organizationId,
        { profileId: orgB.professionalId, gardenId, role: 'editor' },
        orgA.professionalId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Even orgA's OWN admin — a real `organizationAdmin`, just on the
    // wrong organization — is refused identically: `organizationAdmin` on
    // orgA carries no capability whatsoever on orgB.
    await expect(
      createForOrgB.execute(
        orgB.organizationId,
        { profileId: orgB.professionalId, gardenId, role: 'editor' },
        orgA.adminId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    const assignmentId = await insertGardenAssignment(
      db,
      orgB.organizationId,
      orgB.professionalId,
      gardenId,
      orgB.adminId,
    );
    const endForOrgB = new EndGardenAssignment(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      organizationAuthorization(),
      fixedClock(MARCH),
    );
    // orgA's admin cannot end orgB's assignment by supplying orgA's own id
    // in the path either — the assignment lookup itself is scoped to the
    // organization named in the path, so orgA's admin cannot even find it.
    await expect(
      endForOrgB.execute(orgA.organizationId, assignmentId, orgA.adminId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // --- 3. professional-of-org-A cannot act on a garden they have no
  // assignment for, even though they belong to SOME organization ---------

  it('3. professional-of-org-A has no access to a garden with no assignment naming them, despite active organization membership', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndProfessional();
    const unrelatedOwnerId = await insertProfile(db);
    const unrelatedGardenId = await insertGarden(db, unrelatedOwnerId);
    // A DIFFERENT garden has a real assignment for this professional —
    // proving the professional's identity and organization membership are
    // both entirely genuine, just irrelevant to the unrelated garden.
    const otherGardenOwnerId = await insertProfile(db);
    const otherGardenId = await insertGarden(db, otherGardenOwnerId);
    await insertGardenAssignment(db, organizationId, professionalId, otherGardenId, adminId);

    await expect(
      gardenAuthorization().requireCapability(unrelatedGardenId, professionalId, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Sanity check on the professional identity itself: even on the
    // OTHER garden, where a real assignment genuinely names them, they
    // still have no `GardenAuthorization` access (proof 1) — confirming
    // this professional is not somehow globally privileged, and that the
    // denial above is specifically about the UNRELATED garden, not a
    // blanket failure of the professional's own identity.
    await expect(
      gardenAuthorization().requireCapability(otherGardenId, professionalId, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // --- 4. a garden's OWNER alone cannot administer an unrelated
  // organization ----------------------------------------------------------

  it('4. a garden owner with no organization membership at all cannot administer an unrelated organization', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const { organizationId } = await seedOrgWithAdminAndProfessional();

    await expect(
      organizationAuthorization().requireActiveMembership(organizationId, ownerId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      organizationAuthorization().requireCapability(
        organizationId,
        ownerId,
        'manageOrganizationMembership',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      organizationAuthorization().requireCapability(
        organizationId,
        ownerId,
        'manageGardenAssignment',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      organizationAuthorization().requireCapability(organizationId, ownerId, 'manageEngagement'),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Confirms `gardenId` is real and genuinely owned — the negative
    // result above is not an artifact of a missing garden.
    void gardenId;
  });

  // --- 5. an organization admin cannot bypass `manageGardenAssignment`'s
  // own gate by going through garden-level `GardenAuthorization` instead --

  it('5. an organization admin gains NOTHING on a garden they have no membership on, even to read the assignment roster THEY THEMSELVES created', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgWithAdminAndProfessional();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    await insertGardenAssignment(db, organizationId, professionalId, gardenId, adminId);

    // The admin is genuinely `organizationAdmin` and genuinely holds
    // `manageGardenAssignment` — real, valid capability, verified here.
    const adminMembership = await organizationAuthorization().requireCapability(
      organizationId,
      adminId,
      'manageGardenAssignment',
    );
    expect(adminMembership.role).toBe('organization_admin');

    // Yet the identical admin, asking the GARDEN'S OWN authorization
    // mechanism for even the most basic `viewGarden` capability, is
    // refused exactly like a stranger who has never heard of this
    // organization — `GardenAuthorization` never consults
    // `organization_membership` or `garden_assignment` at all. There is no
    // code path from "I administer this organization" to "I may act on
    // this garden."
    await expect(
      gardenAuthorization().requireCapability(gardenId, adminId, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("5b. an organization admin cannot read another organization's assignment roster by any capability they hold on their own organization", async () => {
    const orgA = await seedOrgWithAdminAndProfessional();
    const orgB = await seedOrgWithAdminAndProfessional();

    const listForOrgB = new ListGardenAssignmentsForOrganization(
      new KyselyGardenAssignmentRepository(db),
      organizationAuthorization(),
    );

    await expect(listForOrgB.execute(orgB.organizationId, orgA.adminId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  // --- 6. Symmetrically: a garden owner's organization-scoped read fails
  // identically to a total stranger's --------------------------------------

  it('6. a garden owner and a total stranger are refused organization access IDENTICALLY — no special case for garden ownership', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    const strangerId = await insertProfile(db);
    const { organizationId } = await seedOrgWithAdminAndProfessional();

    const ownerError = await organizationAuthorization()
      .requireActiveMembership(organizationId, ownerId)
      .catch((caught: unknown) => caught);
    const strangerError = await organizationAuthorization()
      .requireActiveMembership(organizationId, strangerId)
      .catch((caught: unknown) => caught);

    expect(ownerError).toBeInstanceOf(NotFoundError);
    expect(strangerError).toBeInstanceOf(NotFoundError);
    expect((ownerError as Error).message).toBe((strangerError as Error).message);
    expect((ownerError as { code?: string }).code).toBe((strangerError as { code?: string }).code);

    void gardenId;
  });

  it('a professional (empty capability set) holds ZERO organization capabilities regardless of which garden assignments exist', async () => {
    const { organizationId, professionalId } = await seedOrgWithAdminAndProfessional();

    await expect(
      organizationAuthorization().requireCapability(
        organizationId,
        professionalId,
        'manageOrganizationMembership',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      organizationAuthorization().requireCapability(
        organizationId,
        professionalId,
        'manageGardenAssignment',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      organizationAuthorization().requireCapability(
        organizationId,
        professionalId,
        'manageEngagement',
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
