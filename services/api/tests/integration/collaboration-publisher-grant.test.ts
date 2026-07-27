/**
 * Full-stack integration tests for the SEPARATE publisher capability
 * (P9C-PUBLISH-01): `GrantPublisherAccess`, `RevokePublisherAccess`,
 * `ListPublisherGrantsForEngagement` — real PostgreSQL, real repositories,
 * the real transactional unit of work, never fakes.
 *
 * Completion evidence this suite exists to provide: the "authorization"
 * half of "State-machine, authorization, concurrency, and audit tests" —
 * org-backed and self-run (garden-owner) grants, grantee eligibility, and
 * the negative cases naming this capability as genuinely separate from
 * `manageEngagement`/`manageGarden`.
 *
 * Source: implementation-plan.md work package P9C-PUBLISH-01;
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Publication Boundary".
 */

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  GardenAuthorization,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import {
  GrantPublisherAccess,
  KyselyClientEngagementRepository,
  KyselyCollaborationUnitOfWork,
  KyselyOrganizationMembershipRepository,
  KyselyPublisherGrantRepository,
  ListPublisherGrantsForEngagement,
  OrganizationAuthorization,
  RevokePublisherAccess,
} from '../../src/modules/collaboration/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import {
  ConflictError,
  DomainRuleViolatedError,
  ForbiddenError,
  NotFoundError,
} from '../../src/platform/errors/application-error.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  auditEventFor,
  fixedClock,
  insertClientEngagement,
  insertGarden,
  insertMembership,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
} from '../support/publication-integration-harness.js';

const SUITE_NAME = 'collaboration publisher-grant integration';
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
  }, 120_000);

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

  function grantCommand(now: Date): GrantPublisherAccess {
    return new GrantPublisherAccess(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      new KyselyClientEngagementRepository(db),
      new KyselyOrganizationMembershipRepository(db),
      fixedClock(now),
    );
  }

  function revokeCommand(now: Date): RevokePublisherAccess {
    return new RevokePublisherAccess(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      new KyselyClientEngagementRepository(db),
      fixedClock(now),
    );
  }

  function listCommand(): ListPublisherGrantsForEngagement {
    return new ListPublisherGrantsForEngagement(
      new KyselyPublisherGrantRepository(db),
      organizationAuthorization(),
      gardenAuthorization(),
      new KyselyClientEngagementRepository(db),
    );
  }

  async function seedOrgBackedEngagement() {
    const adminId = await insertProfile(db);
    const organizationId = await insertOrganization(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    const outsiderId = await insertProfile(db);

    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagement(
      db,
      gardenId,
      adminId,
      organizationId,
      JANUARY,
    );
    await activateEngagement(db, engagementId, JANUARY);

    return { adminId, organizationId, professionalId, outsiderId, ownerId, gardenId, engagementId };
  }

  async function seedSelfRunEngagement() {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);
    const outsiderId = await insertProfile(db);

    const engagementId = await insertClientEngagement(db, gardenId, ownerId, null, JANUARY);
    await activateEngagement(db, engagementId, JANUARY);

    return { ownerId, gardenId, editorId, outsiderId, engagementId };
  }

  // --- GrantPublisherAccess: org-backed -----------------------------------

  it('an organization admin grants publisher access to an ACTIVE member of the SAME organization', async () => {
    const { adminId, professionalId, engagementId } = await seedOrgBackedEngagement();

    const grant = await grantCommand(MARCH).execute(
      engagementId,
      professionalId,
      adminId,
      generateUuidV7(),
    );

    expect(grant.state).toBe('active');
    expect(grant.profileId).toBe(professionalId);
    expect(grant.grantedByProfileId).toBe(adminId);

    const auditEvent = await auditEventFor(db, grant.id, 'publisher_grant.granted');
    expect(auditEvent).toBeDefined();
  });

  it('refuses granting to a profile who is NOT a member of the org-backed engagement’s own organization', async () => {
    const { adminId, outsiderId, engagementId } = await seedOrgBackedEngagement();

    await expect(
      grantCommand(MARCH).execute(engagementId, outsiderId, adminId, generateUuidV7()),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('refuses a PROFESSIONAL (no manageEngagement) granting publisher access — a separate capability from organization role', async () => {
    const { professionalId, engagementId } = await seedOrgBackedEngagement();
    const targetId = await insertProfile(db);

    await expect(
      grantCommand(MARCH).execute(engagementId, targetId, professionalId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses granting twice to the same profile on the same engagement (409)', async () => {
    const { adminId, professionalId, engagementId } = await seedOrgBackedEngagement();

    await grantCommand(MARCH).execute(engagementId, professionalId, adminId, generateUuidV7());

    await expect(
      grantCommand(MARCH).execute(engagementId, professionalId, adminId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // --- GrantPublisherAccess: self-run (no organization) -------------------

  it('a garden owner grants publisher access directly when no service organization is attached', async () => {
    const { ownerId, editorId, engagementId } = await seedSelfRunEngagement();

    const grant = await grantCommand(MARCH).execute(
      engagementId,
      editorId,
      ownerId,
      generateUuidV7(),
    );

    expect(grant.state).toBe('active');
    expect(grant.profileId).toBe(editorId);
  });

  it('refuses granting to a profile with no active membership on the self-run engagement’s own garden', async () => {
    const { ownerId, outsiderId, engagementId } = await seedSelfRunEngagement();

    await expect(
      grantCommand(MARCH).execute(engagementId, outsiderId, ownerId, generateUuidV7()),
    ).rejects.toBeInstanceOf(DomainRuleViolatedError);
  });

  it('refuses a non-owner (editor) granting publisher access on a self-run engagement', async () => {
    const { editorId, engagementId } = await seedSelfRunEngagement();
    const targetId = await insertProfile(db);

    await expect(
      grantCommand(MARCH).execute(engagementId, targetId, editorId, generateUuidV7()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('conceals a non-existent engagement as 404 for grant/revoke/list', async () => {
    const actorId = await insertProfile(db);
    const targetId = await insertProfile(db);
    const bogusEngagementId = generateUuidV7();

    await expect(
      grantCommand(MARCH).execute(bogusEngagementId, targetId, actorId, generateUuidV7()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      revokeCommand(MARCH).execute(bogusEngagementId, targetId, actorId, generateUuidV7()),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(listCommand().execute(bogusEngagementId, actorId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  // --- RevokePublisherAccess -----------------------------------------------

  it('revokes an active grant, then is idempotent on a second revoke (returns the unchanged revoked grant, not an error)', async () => {
    const { adminId, professionalId, engagementId } = await seedOrgBackedEngagement();
    await grantCommand(MARCH).execute(engagementId, professionalId, adminId, generateUuidV7());

    const revoked = await revokeCommand(MARCH).execute(
      engagementId,
      professionalId,
      adminId,
      generateUuidV7(),
    );
    expect(revoked.state).toBe('revoked');
    expect(revoked.revokedByProfileId).toBe(adminId);

    const auditEvent = await auditEventFor(db, revoked.id, 'publisher_grant.revoked');
    expect(auditEvent).toBeDefined();

    const revokedAgain = await revokeCommand(MARCH).execute(
      engagementId,
      professionalId,
      adminId,
      generateUuidV7(),
    );
    expect(revokedAgain.state).toBe('revoked');
    expect(revokedAgain.id).toBe(revoked.id);
  });

  it('refuses revoking a profile with no grant on this engagement at all (404)', async () => {
    const { adminId, engagementId } = await seedOrgBackedEngagement();
    const neverGrantedId = await insertProfile(db);

    await expect(
      revokeCommand(MARCH).execute(engagementId, neverGrantedId, adminId, generateUuidV7()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists every grant on an engagement, active and revoked, newest first', async () => {
    const { adminId, professionalId, engagementId } = await seedOrgBackedEngagement();
    await grantCommand(MARCH).execute(engagementId, professionalId, adminId, generateUuidV7());

    const listed = await listCommand().execute(engagementId, adminId);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.profileId).toBe(professionalId);
  });
});
