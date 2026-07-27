/**
 * Full-stack integration tests for client-engagement lifecycle (P9B-API-01):
 * `CreateClientEngagement`, `ActivateClientEngagement`, `EndClientEngagement`,
 * `RevokeClientEngagement`, `ListClientEngagementsForOrganization`,
 * `ListClientEngagementsForGarden` — including the dual authorization gate
 * (organization-backed versus garden-owner-run engagements).
 *
 * Source: implementation-plan.md work package P9B-API-01;
 * architecture/collaboration-and-client-sharing.md, section
 * "8. Client Engagement".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  ActivateClientEngagement,
  CreateClientEngagement,
  EndClientEngagement,
  KyselyClientEngagementRepository,
  KyselyCollaborationUnitOfWork,
  KyselyOrganizationMembershipRepository,
  ListClientEngagementsForGarden,
  ListClientEngagementsForOrganization,
  OrganizationAuthorization,
  RevokeClientEngagement,
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
import {
  auditEventFor,
  insertGarden,
  insertMembership,
} from '../support/collaboration-integration-harness.js';
import {
  fixedClock,
  insertClientEngagement,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
} from '../support/organization-integration-harness.js';

const SUITE_NAME = 'collaboration client-engagement lifecycle integration';
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

  function createEngagementCommand(now: Date): CreateClientEngagement {
    return new CreateClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      new KyselyGardenRepository(db),
      fixedClock(now),
    );
  }

  function activateEngagementCommand(now: Date): ActivateClientEngagement {
    return new ActivateClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      fixedClock(now),
    );
  }

  function endEngagementCommand(now: Date): EndClientEngagement {
    return new EndClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      fixedClock(now),
    );
  }

  function revokeEngagementCommand(now: Date): RevokeClientEngagement {
    return new RevokeClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      organizationAuthorization(),
      gardenAuthorization(),
      fixedClock(now),
    );
  }

  async function seedOrgWithAdmin() {
    const adminId = await insertProfile(db);
    const organizationId = await insertOrganization(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    return { adminId, organizationId };
  }

  async function seedGardenWithOwner() {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    return { ownerId, gardenId };
  }

  // --- CreateClientEngagement (dual gate) -------------------------------

  it('an organization admin creates an org-backed engagement for ANY existing garden, unconditionally', async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const { gardenId } = await seedGardenWithOwner();

    const engagement = await createEngagementCommand(MARCH).execute(
      { gardenId, serviceOrganizationId: organizationId },
      adminId,
      randomUUID(),
    );

    expect(engagement.state).toBe('draft');
    expect(engagement.serviceOrganizationId).toBe(organizationId);
    expect(engagement.stewardshipPolicy).toBe('residential');
    expect(engagement.clientNotificationsEnabled).toBe(true);
  });

  it('a garden owner creates a self-run engagement with no service organization', async () => {
    const { ownerId, gardenId } = await seedGardenWithOwner();

    const engagement = await createEngagementCommand(MARCH).execute(
      { gardenId },
      ownerId,
      randomUUID(),
    );

    expect(engagement.state).toBe('draft');
    expect(engagement.serviceOrganizationId).toBeUndefined();
  });

  it('rejects an organization member without manageEngagement from creating an org-backed engagement', async () => {
    const { organizationId } = await seedOrgWithAdmin();
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    const { gardenId } = await seedGardenWithOwner();

    await expect(
      createEngagementCommand(MARCH).execute(
        { gardenId, serviceOrganizationId: organizationId },
        professionalId,
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a non-owner from creating a self-run engagement with no organization', async () => {
    const { gardenId } = await seedGardenWithOwner();
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);

    await expect(
      createEngagementCommand(MARCH).execute({ gardenId }, editorId, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects an org-backed engagement naming a garden id that does not exist', async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();

    await expect(
      createEngagementCommand(MARCH).execute(
        { gardenId: randomUUID(), serviceOrganizationId: organizationId },
        adminId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'garden.not_found' });
  });

  // --- ActivateClientEngagement / EndClientEngagement / RevokeClientEngagement

  it('activates a draft engagement, idempotently', async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const { gardenId } = await seedGardenWithOwner();
    const engagementId = await insertClientEngagement(db, gardenId, adminId, organizationId);

    const activated = await activateEngagementCommand(MARCH).execute(
      engagementId,
      adminId,
      randomUUID(),
    );
    expect(activated.state).toBe('active');

    const activatedAgain = await activateEngagementCommand(MARCH).execute(
      engagementId,
      adminId,
      randomUUID(),
    );
    expect(activatedAgain.state).toBe('active');
  });

  it('refuses to activate an ended engagement', async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const { gardenId } = await seedGardenWithOwner();
    const engagementId = await insertClientEngagement(db, gardenId, adminId, organizationId);
    await activateEngagementCommand(MARCH).execute(engagementId, adminId, randomUUID());
    await endEngagementCommand(MARCH).execute(engagementId, adminId, randomUUID());

    await expect(
      activateEngagementCommand(MARCH).execute(engagementId, adminId, randomUUID()),
    ).rejects.toMatchObject({ code: 'client_engagement.invalid_transition' });
  });

  it('ends an active engagement using the SAME authorization gate the engagement was created under, re-read from the stored row', async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const { gardenId } = await seedGardenWithOwner();
    const engagementId = await insertClientEngagement(db, gardenId, adminId, organizationId);
    await activateEngagementCommand(MARCH).execute(engagementId, adminId, randomUUID());

    const ended = await endEngagementCommand(MARCH).execute(engagementId, adminId, randomUUID());
    expect(ended.state).toBe('ended');
  });

  it("rejects a DIFFERENT organization's admin from acting on this engagement", async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const other = await seedOrgWithAdmin();
    const { gardenId } = await seedGardenWithOwner();
    const engagementId = await insertClientEngagement(db, gardenId, adminId, organizationId);

    await expect(
      activateEngagementCommand(MARCH).execute(engagementId, other.adminId, randomUUID()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('revokes a draft engagement directly (no activation required), and refuses to revoke an already-ended one', async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const { gardenId } = await seedGardenWithOwner();
    const draftId = await insertClientEngagement(db, gardenId, adminId, organizationId);

    const revoked = await revokeEngagementCommand(MARCH).execute(
      draftId,
      adminId,
      'client changed their mind',
      randomUUID(),
    );
    expect(revoked.state).toBe('revoked');
    expect(revoked.revokedReason).toBe('client changed their mind');

    // Prohibited-content telemetry (P9C-OBS-01): a revocation reason is
    // free text (section 19's own "notes" exclusion) — only presence is
    // recorded, never the value, even though the command itself received it.
    const auditRevoked = await auditEventFor(db, draftId, 'client_engagement.revoked');
    expect(auditRevoked).toBeDefined();
    expect(auditRevoked?.details).toMatchObject({ hasReason: true });
    expect(JSON.stringify(auditRevoked?.details)).not.toContain('client changed their mind');

    const endedId = await insertClientEngagement(db, gardenId, adminId, organizationId);
    await activateEngagementCommand(MARCH).execute(endedId, adminId, randomUUID());
    await endEngagementCommand(MARCH).execute(endedId, adminId, randomUUID());

    await expect(
      revokeEngagementCommand(MARCH).execute(endedId, adminId, null, randomUUID()),
    ).rejects.toMatchObject({ code: 'client_engagement.invalid_transition' });
  });

  it('a garden owner (no organization) activates/ends/revokes their own self-run engagement', async () => {
    const { ownerId, gardenId } = await seedGardenWithOwner();
    const engagementId = await insertClientEngagement(db, gardenId, ownerId, null);

    const activated = await activateEngagementCommand(MARCH).execute(
      engagementId,
      ownerId,
      randomUUID(),
    );
    expect(activated.state).toBe('active');

    const ended = await endEngagementCommand(MARCH).execute(engagementId, ownerId, randomUUID());
    expect(ended.state).toBe('ended');
  });

  it('DomainRuleViolatedError is thrown for an invalid transition attempt', async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const { gardenId } = await seedGardenWithOwner();
    const engagementId = await insertClientEngagement(db, gardenId, adminId, organizationId);
    await activateEngagementCommand(MARCH).execute(engagementId, adminId, randomUUID());
    await endEngagementCommand(MARCH).execute(engagementId, adminId, randomUUID());

    const error = await activateEngagementCommand(MARCH)
      .execute(engagementId, adminId, randomUUID())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DomainRuleViolatedError);
  });

  // --- ListClientEngagementsForOrganization / ListClientEngagementsForGarden

  it("lists an organization's engagements in every state, visible to any active member", async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    const { gardenId } = await seedGardenWithOwner();
    const engagementId = await insertClientEngagement(db, gardenId, adminId, organizationId);

    const listForOrganization = new ListClientEngagementsForOrganization(
      new KyselyClientEngagementRepository(db),
      organizationAuthorization(),
    );

    const result = await listForOrganization.execute(organizationId, professionalId);
    expect(result.items.map((item) => item.id)).toEqual([engagementId]);
  });

  it("lists a garden's engagements, OWNER-ONLY (manageGarden) — an editor is refused", async () => {
    const { adminId, organizationId } = await seedOrgWithAdmin();
    const { ownerId, gardenId } = await seedGardenWithOwner();
    const editorId = await insertProfile(db);
    await insertMembership(db, gardenId, editorId, 'editor', JANUARY);
    const engagementId = await insertClientEngagement(db, gardenId, adminId, organizationId);

    const listForGarden = new ListClientEngagementsForGarden(
      new KyselyClientEngagementRepository(db),
      gardenAuthorization(),
    );

    const result = await listForGarden.execute(gardenId, ownerId);
    expect(result.items.map((item) => item.id)).toEqual([engagementId]);

    await expect(listForGarden.execute(gardenId, editorId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
