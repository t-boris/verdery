/**
 * P9-QA-01 (Batch A), matrix 2 — ORGANIZATION MEMBERSHIP + GARDEN ASSIGNMENT
 * COMPOSITION.
 *
 * `collaboration-organization-garden-denial-matrix.test.ts` already proves,
 * in isolation, that organization membership alone grants zero garden
 * access (its own proof 1, and proofs 3/5) and that an active
 * `garden_assignment` alone grants access matching its own role (proof 1).
 * This file's first test reproves the "alone -> zero access" half only
 * briefly, as the necessary first half of a composition claim — it is not
 * this file's point.
 *
 * The genuinely cross-subphase case NO existing suite covers: the SAME
 * profile holding BOTH an operational `collaboration.membership` (P9A) AND
 * an organization `garden_assignment` (P9B) on the SAME garden at the same
 * time. This is a real situation — a professional who is also a household
 * member (or was invited operationally before their organization was ever
 * assigned) — and per this package's own instructions, the answer is NOT
 * assumed here; it is read directly from `GardenAuthorization.resolveAccess`
 * (`gardens-mapping/application/garden-authorization.ts`) and proven by
 * exercising the real Kysely adapters against both sources at once.
 *
 * READING THE CODE FIRST, NOT ASSUMING: `resolveAccess` tries
 * `MembershipRepository.findGardenAccess` FIRST; the assignment source
 * (`GardenAssignmentAccessSource`) is consulted ONLY when membership access
 * is `null`. This is a STRICT PRECEDENCE ("does the caller have ordinary
 * membership at all"), not a UNION that resolves to whichever grant is more
 * permissive — the two are alternate paths to *some* access existing at all
 * (ADR-0012's own "garden assignment OR operational garden membership"),
 * not two capability grants that get combined. Both tests below prove this
 * precisely, in both directions, so there is no ambiguity: when membership
 * is LESS permissive than the assignment (viewer + editor-assignment), the
 * caller still gets only viewer — the assignment is never even consulted;
 * when membership happens to be MORE permissive (editor + viewer-assignment),
 * the caller gets editor, but only because membership itself already grants
 * it, not because the two were combined.
 *
 * Source: implementation-plan.md work packages P9A-API-01, P9B-API-02;
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md;
 * gardens-mapping/application/garden-authorization.ts;
 * gardens-mapping/application/garden-assignment-access-source.ts.
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  GardenAuthorization,
  KyselyGardenAssignmentAccessSource,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden } from '../support/collaboration-integration-harness.js';
import {
  insertGardenAssignment,
  insertMembership,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
} from '../support/organization-integration-harness.js';

const SUITE_NAME = 'p9-qa: organization membership + garden assignment composition';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');

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

  function gardenAuthorization(): GardenAuthorization {
    return new GardenAuthorization(
      new KyselyMembershipRepository(db),
      new KyselyGardenAssignmentAccessSource(db),
    );
  }

  async function seedOrgProfessional() {
    const adminId = await insertProfile(db);
    const organizationId = await insertOrganization(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    return { adminId, organizationId, professionalId };
  }

  it('organization membership ALONE — no garden_assignment, no operational membership — grants zero access to a specific garden', async () => {
    const { professionalId } = await seedOrgProfessional();
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);

    // The professional is a genuine, active member of a genuine
    // organization — this is not a stranger to the system, only a stranger
    // to THIS garden.
    await expect(
      gardenAuthorization().requireCapability(gardenId, professionalId, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('membership LESS permissive than the assignment (viewer membership + editor assignment, same garden): the caller gets ONLY viewer — membership wins outright, the assignment is never consulted, this does NOT compose to the more permissive grant', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgProfessional();
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);

    // The SAME profile genuinely holds BOTH grants on the SAME garden.
    const membershipId = await insertMembership(db, gardenId, professionalId, 'viewer', JANUARY);
    await insertGardenAssignment(db, organizationId, professionalId, gardenId, adminId, 'editor');

    const viewGrant = await gardenAuthorization().requireCapability(
      gardenId,
      professionalId,
      'viewGarden',
    );
    // Proof of WHICH source answered: the returned membership id is the
    // OPERATIONAL membership row's own id, never the assignment's — direct,
    // unambiguous evidence of precedence, not merely a matching role.
    expect(viewGrant.id).toBe(membershipId);
    expect(viewGrant.role).toBe('viewer');

    // If the two composed to the more permissive grant, this would succeed
    // (the assignment alone carries `editor`, which holds
    // `editGardenContent`). It does not: the caller is refused exactly as a
    // plain viewer with no assignment at all would be.
    await expect(
      gardenAuthorization().requireCapability(gardenId, professionalId, 'editGardenContent'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('membership MORE permissive than the assignment (editor membership + viewer assignment, same garden): the caller gets editor — because membership itself already grants it, not because the two combined', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgProfessional();
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);

    const membershipId = await insertMembership(db, gardenId, professionalId, 'editor', JANUARY);
    await insertGardenAssignment(db, organizationId, professionalId, gardenId, adminId, 'viewer');

    const editGrant = await gardenAuthorization().requireCapability(
      gardenId,
      professionalId,
      'editGardenContent',
    );
    // Same proof of provenance as the previous test, in the opposite
    // direction: the membership row answered, not the (less permissive)
    // assignment — the outcome here happens to look like "the more
    // permissive grant won," but only because membership was already the
    // more permissive one; the mechanism is identical strict precedence in
    // both tests, not a union that picks the larger capability set.
    expect(editGrant.id).toBe(membershipId);
    expect(editGrant.role).toBe('editor');
  });

  it('removing the operational membership while the assignment remains active makes the assignment the ONLY remaining source — access survives, now sourced from the assignment, at the assignment’s own (possibly different) role', async () => {
    const { adminId, organizationId, professionalId } = await seedOrgProfessional();
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);

    await insertMembership(db, gardenId, professionalId, 'viewer', JANUARY);
    const assignmentId = await insertGardenAssignment(
      db,
      organizationId,
      professionalId,
      gardenId,
      adminId,
      'editor',
    );

    // Before: membership answers, viewer only (matches the first test above).
    await expect(
      gardenAuthorization().requireCapability(gardenId, professionalId, 'editGardenContent'),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The operational membership is revoked directly (mirrors what
    // `RemoveMember` does to the row) — the assignment itself is untouched.
    await db
      .updateTable('collaboration.membership')
      .set({ state: 'removed' })
      .where('garden_id', '=', gardenId)
      .where('profile_id', '=', professionalId)
      .execute();

    // After: `findGardenAccess` now finds nothing active, so the fallback
    // runs — the assignment's OWN `editor` role now applies, provable by the
    // returned membership id being the assignment's id, not a stale
    // operational one.
    const editGrant = await gardenAuthorization().requireCapability(
      gardenId,
      professionalId,
      'editGardenContent',
    );
    expect(editGrant.id).toBe(assignmentId);
    expect(editGrant.role).toBe('editor');
  });
});
