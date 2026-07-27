/**
 * P9-QA-01 (Batch A), matrix 5 — THE REMOVED/REVOKED ACTOR SWEEP.
 *
 * The highest-value matrix in this package: for each of SIX distinct KINDS
 * of access loss Phase 9 introduced, confirm the SAME actor is denied across
 * EVERY surface they could have reached before losing it — not just the one
 * surface the removing command's own work-package suite already tested.
 * Table-driven, one setup/revoke/verify block per scenario, to stay under
 * this codebase's 600-line file limit.
 *
 *   (a) operational member removed          -> REST + sync pull
 *   (b) ownership dropped to a lower role    -> REST (partial: owner-only
 *       capability denied, lower-role capability survives) + sync (no
 *       spurious tombstone — still an active member)
 *   (c) organization membership removed      -> REST (organization-scoped);
 *       PLUS the documented finding that a SEPARATE garden_assignment, if
 *       one exists, is an independent lifecycle this command never touches
 *   (d) garden_assignment revoked            -> REST + operational media
 *   (e) client engagement revoked            -> portal + media + export
 *   (f) client access grant individually
 *       revoked                              -> portal + media + export,
 *       while the ENGAGEMENT and a DIFFERENT client on it are unaffected
 *
 * Sync pull is proven only for (a)/(b): `GetSyncChanges` partitions purely
 * from `collaboration.membership` (`get-sync-changes.ts`'s own header) — an
 * assignment-only professional or a client has no sync partition to lose in
 * the first place, so "sync" is not an applicable surface for (c)-(f), per
 * this package's own "(where applicable to that actor type)" instruction.
 * Export is not applicable to (a)-(d): `exportGarden` is owner-only and
 * `garden_assignment.role` is schema-forbidden from ever being `owner`
 * (already proven by `collaboration-organization-garden-denial-matrix
 * .test.ts`'s own proof 1) — re-proving that here would be redundant, not
 * a new surface.
 *
 * Source: implementation-plan.md work packages P9A-API-01, P9A-OWNER-01,
 * P9A-SYNC-01, P9B-API-01, P9B-API-02, P9C-INVITE-01, P9C-API-01,
 * P9C-MEDIA-01, P9C-EXPORT-01; architecture/collaboration-and-client-
 * sharing.md, section "15. Synchronization and Revocation".
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import {
  ClientPortalAuthorization,
  GetClientGardenOverview,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyClientPublicationReadRepository,
  KyselyCollaborationUnitOfWork,
  KyselyOrganizationMembershipRepository,
  OrganizationAuthorization,
  RemoveOrganizationMember,
  RevokeClientEngagement,
  RevokeClientInvitation,
  RevokeGardenAssignment,
} from '../../src/modules/collaboration/public.js';
import {
  GardenAuthorization,
  KyselyGardenAssignmentAccessSource,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import {
  GetClientMediaAccess,
  GetMediaAccess,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
} from '../../src/modules/media/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyAuditLogger } from '../../src/platform/audit/kysely-audit-logger.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { ForbiddenError, NotFoundError } from '../../src/platform/errors/application-error.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { buildSyncTestHarness, syncActor } from '../support/sync-test-harness.js';
import {
  insertGarden as insertGardenPgHelper,
  insertMembership as insertMembershipPg,
  insertProfile as insertProfilePg,
} from '../support/collaboration-fixtures.js';
import {
  fixedClock,
  insertGarden,
  insertGardenAssignment,
  insertOrganization,
  insertOrganizationMembership,
  insertProfile,
} from '../support/organization-integration-harness.js';
import { insertMediaRecord as insertMediaRecordDb } from '../support/publication-integration-harness.js';
import {
  insertClientEngagement,
  insertClientAccessGrant,
} from '../support/service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertMediaRecord as insertMediaRecordPg,
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';

const SUITE_NAME = 'p9-qa: removed/revoked actor sweep';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NOW = new Date('2026-07-21T09:00:00Z');
const JANUARY = new Date('2026-01-10T09:00:00Z');

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let pgClient: pg.Client;

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

    pgClient = new pg.Client({ connectionString: databaseUrl });
    await pgClient.connect();
  }, 120_000);

  afterAll(async () => {
    await pgClient.end();
    await db.destroy();
    await container?.stop();
  });

  function orgAuthorization(): OrganizationAuthorization {
    return new OrganizationAuthorization(new KyselyOrganizationMembershipRepository(db));
  }

  function gardenAuthorization(): GardenAuthorization {
    return new GardenAuthorization(
      new KyselyMembershipRepository(db),
      new KyselyGardenAssignmentAccessSource(db),
    );
  }

  function portalAuthorization(): ClientPortalAuthorization {
    return new ClientPortalAuthorization(
      new KyselyClientAccessGrantRepository(db),
      new KyselyClientEngagementRepository(db),
    );
  }

  function overviewCommand(): GetClientGardenOverview {
    return new GetClientGardenOverview(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );
  }

  function clientMediaAccessCommand(): GetClientMediaAccess {
    return new GetClientMediaAccess(
      new KyselyMediaRepository(db),
      new KyselyClientMediaEntitlementSource(db),
      new FakeMediaStorageGateway(),
      new KyselyAuditLogger(db, fixedClock(NOW)),
      fixedClock(NOW),
    );
  }

  // --- (a) operational member removed ------------------------------------

  it('(a) operational member removed: next REST call denied, sync pull emits the RemoveMember tombstone', async () => {
    const harness = buildSyncTestHarness(db, fixedClock(NOW));
    const ownerId = await insertProfile(db);
    const memberId = await insertProfile(db);
    const garden = await harness.createGarden.execute(ownerId, 'Sweep garden A', randomUUID());
    const invitation = await harness.createInvitation.execute(
      garden.id,
      ownerId,
      { intendedRole: 'editor' },
      randomUUID(),
    );
    await harness.acceptInvitation.execute(
      { profileId: memberId, email: undefined, emailVerified: false },
      invitation.token,
      randomUUID(),
    );
    const baseline = await harness.getSyncChanges.execute(memberId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    await harness.removeMember.execute(garden.id, memberId, ownerId, randomUUID());

    await expect(harness.getGarden.execute(garden.id, memberId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const afterRemoval = await harness.getSyncChanges.execute(memberId, {
      after: baseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(afterRemoval.items).toEqual([
      expect.objectContaining({ recordType: 'garden', operation: 'delete', gardenId: garden.id }),
    ]);
  });

  // --- (b) ownership dropped to a lower role ------------------------------

  it('(b) ownership dropped to a lower role (DemoteOwner): owner-only REST calls now forbidden while lower-role capability survives; no spurious sync tombstone', async () => {
    const harness = buildSyncTestHarness(db, fixedClock(NOW));
    const ownerId = await insertProfile(db);
    const coOwnerId = await insertProfile(db);
    const garden = await harness.createGarden.execute(ownerId, 'Sweep garden B', randomUUID());
    const invitation = await harness.createInvitation.execute(
      garden.id,
      ownerId,
      { intendedRole: 'editor' },
      randomUUID(),
    );
    await harness.acceptInvitation.execute(
      { profileId: coOwnerId, email: undefined, emailVerified: false },
      invitation.token,
      randomUUID(),
    );
    await harness.promoteToOwner.execute(garden.id, coOwnerId, syncActor(ownerId), randomUUID());
    await expect(
      harness.gardenAuthorization.requireCapability(garden.id, coOwnerId, 'manageGarden'),
    ).resolves.toBeDefined();
    const baseline = await harness.getSyncChanges.execute(coOwnerId, {
      after: null,
      limit: 50,
      protocolVersion: 1,
    });

    await harness.demoteOwner.execute(
      garden.id,
      coOwnerId,
      syncActor(ownerId),
      'editor',
      randomUUID(),
    );

    // REST: owner-only capability denied — FORBIDDEN, not notFound, because
    // some access genuinely remains.
    await expect(
      harness.gardenAuthorization.requireCapability(garden.id, coOwnerId, 'manageGarden'),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // The lower-role capability they were dropped TO still works.
    await expect(
      harness.gardenAuthorization.requireCapability(garden.id, coOwnerId, 'editGardenContent'),
    ).resolves.toBeDefined();
    // Sync: a role change produces no spurious revocation or grant.
    const afterDemotion = await harness.getSyncChanges.execute(coOwnerId, {
      after: baseline.nextCursor,
      limit: 50,
      protocolVersion: 1,
    });
    expect(afterDemotion.items).toHaveLength(0);
  });

  // --- (c) organization membership removed --------------------------------

  it('(c) organization membership removed: every organization-scoped REST capability is denied — but a SEPARATE garden_assignment is an independent lifecycle this command never touches, and keeps granting garden access (documented finding, not re-invented as a bug)', async () => {
    const organizationId = await insertOrganization(db);
    const removedAdminId = await insertProfile(db);
    const secondAdminId = await insertProfile(db);
    await insertOrganizationMembership(
      db,
      organizationId,
      removedAdminId,
      'organization_admin',
      JANUARY,
    );
    await insertOrganizationMembership(
      db,
      organizationId,
      secondAdminId,
      'organization_admin',
      JANUARY,
    );
    // A real, independent assignment for the SAME profile, unrelated to
    // their org-admin status.
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    await insertGardenAssignment(
      db,
      organizationId,
      removedAdminId,
      gardenId,
      removedAdminId,
      'editor',
    );

    await expect(
      orgAuthorization().requireCapability(
        organizationId,
        removedAdminId,
        'manageGardenAssignment',
      ),
    ).resolves.toBeDefined();
    await expect(
      gardenAuthorization().requireCapability(gardenId, removedAdminId, 'viewGarden'),
    ).resolves.toBeDefined();

    const removeOrgMember = new RemoveOrganizationMember(
      new KyselyIdempotencyStore(db, fixedClock(NOW)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(NOW)),
      orgAuthorization(),
      fixedClock(NOW),
    );
    await removeOrgMember.execute(organizationId, removedAdminId, secondAdminId, randomUUID());

    // REST: every organization-scoped capability, gone.
    await expect(
      orgAuthorization().requireActiveMembership(organizationId, removedAdminId),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      orgAuthorization().requireCapability(
        organizationId,
        removedAdminId,
        'manageGardenAssignment',
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    // The documented finding: `RemoveOrganizationMember` never touches
    // `collaboration.garden_assignment` — the independent grant survives
    // until someone separately revokes/ends IT (scenario (d) below).
    await expect(
      gardenAuthorization().requireCapability(gardenId, removedAdminId, 'viewGarden'),
    ).resolves.toBeDefined();
  });

  // --- (d) garden_assignment revoked --------------------------------------

  it('(d) garden_assignment revoked: REST and operational media access both denied for the professional, while their organization membership itself is untouched', async () => {
    const organizationId = await insertOrganization(db);
    const adminId = await insertProfile(db);
    const professionalId = await insertProfile(db);
    await insertOrganizationMembership(db, organizationId, adminId, 'organization_admin', JANUARY);
    await insertOrganizationMembership(db, organizationId, professionalId, 'professional', JANUARY);
    const gardenOwnerId = await insertProfile(db);
    const gardenId = await insertGarden(db, gardenOwnerId);
    const assignmentId = await insertGardenAssignment(
      db,
      organizationId,
      professionalId,
      gardenId,
      adminId,
      'editor',
    );
    const mediaId = await insertMediaRecordDb(db, gardenId, gardenOwnerId, 'available');
    await db
      .updateTable('media.media_record')
      .set({ processing_state: 'processed' })
      .where('id', '=', mediaId)
      .execute();
    const mediaAccess = new GetMediaAccess(
      new KyselyMediaRepository(db),
      gardenAuthorization(),
      new FakeMediaStorageGateway(),
      new KyselyAuditLogger(db, fixedClock(NOW)),
      fixedClock(NOW),
    );

    await expect(
      gardenAuthorization().requireCapability(gardenId, professionalId, 'viewGarden'),
    ).resolves.toBeDefined();
    await expect(mediaAccess.execute(gardenId, mediaId, professionalId)).resolves.toBeDefined();

    const revokeAssignment = new RevokeGardenAssignment(
      new KyselyIdempotencyStore(db, fixedClock(NOW)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(NOW)),
      orgAuthorization(),
      fixedClock(NOW),
    );
    await revokeAssignment.execute(organizationId, assignmentId, adminId, randomUUID());

    await expect(
      gardenAuthorization().requireCapability(gardenId, professionalId, 'viewGarden'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(mediaAccess.execute(gardenId, mediaId, professionalId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // The organization membership itself is a separate lifecycle, entirely
    // untouched by revoking one assignment.
    await expect(
      orgAuthorization().requireActiveMembership(organizationId, professionalId),
    ).resolves.toBeDefined();
  });

  // --- (e) client engagement revoked --------------------------------------

  it('(e) client engagement revoked: portal, media, AND export all denied for the entitled client together', async () => {
    const staffId = await insertProfilePg(pgClient);
    const gardenId = await insertGardenPgHelper(pgClient, staffId);
    await insertMembershipPg(pgClient, gardenId, staffId, 'owner');
    const clientProfileId = await insertProfilePg(pgClient);
    const engagementId = await insertClientEngagement(pgClient, gardenId, staffId, {
      state: 'active',
      activated_at: NOW,
    });
    await insertClientAccessGrant(pgClient, engagementId, {
      client_profile_id: clientProfileId,
      state: 'active',
      granted_at: NOW,
    });
    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      engagementId,
      gardenId,
      staffId,
      staffId,
    );
    const publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      engagementId,
      gardenId,
      staffId,
    );
    const mediaId = await insertMediaRecordPg(pgClient, staffId, {
      garden_id: gardenId,
      processing_state: 'processed',
      bucket_name: 'test-user-media',
      object_key: `ab/p9-qa-sweep/${randomUUID()}`,
    });
    await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, mediaId);

    await expect(overviewCommand().execute(clientProfileId, engagementId)).resolves.toBeDefined();
    await expect(
      clientMediaAccessCommand().execute(clientProfileId, mediaId),
    ).resolves.toBeDefined();

    const revokeEngagement = new RevokeClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(NOW)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(NOW)),
      orgAuthorization(),
      gardenAuthorization(),
      fixedClock(NOW),
    );
    await revokeEngagement.execute(engagementId, staffId, 'sweep test', randomUUID());

    await expect(overviewCommand().execute(clientProfileId, engagementId)).rejects.toMatchObject({
      category: 'notFound',
    });
    await expect(
      clientMediaAccessCommand().execute(clientProfileId, mediaId),
    ).rejects.toMatchObject({ category: 'notFound' });
  });

  // --- (f) client access grant individually revoked -----------------------

  it('(f) client access grant individually revoked: THIS client is denied portal and media while the ENGAGEMENT and a DIFFERENT client on it are unaffected', async () => {
    const staffId = await insertProfilePg(pgClient);
    const gardenId = await insertGardenPgHelper(pgClient, staffId);
    await insertMembershipPg(pgClient, gardenId, staffId, 'owner');
    const engagementId = await insertClientEngagement(pgClient, gardenId, staffId, {
      state: 'active',
      activated_at: NOW,
    });
    const revokedClientId = await insertProfilePg(pgClient);
    const grantId = await insertClientAccessGrant(pgClient, engagementId, {
      client_profile_id: revokedClientId,
      state: 'active',
      granted_at: NOW,
    });
    const otherClientId = await insertProfilePg(pgClient);
    await insertClientAccessGrant(pgClient, engagementId, {
      client_profile_id: otherClientId,
      state: 'active',
      granted_at: NOW,
    });
    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      engagementId,
      gardenId,
      staffId,
      staffId,
    );
    const publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      engagementId,
      gardenId,
      staffId,
    );
    const mediaId = await insertMediaRecordPg(pgClient, staffId, {
      garden_id: gardenId,
      processing_state: 'processed',
      bucket_name: 'test-user-media',
      object_key: `ab/p9-qa-sweep/${randomUUID()}`,
    });
    await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, mediaId);

    await expect(overviewCommand().execute(revokedClientId, engagementId)).resolves.toBeDefined();

    const revokeInvitation = new RevokeClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(NOW)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(NOW)),
      orgAuthorization(),
      gardenAuthorization(),
      new KyselyClientEngagementRepository(db),
      fixedClock(NOW),
    );
    await revokeInvitation.execute(engagementId, grantId, staffId, randomUUID());

    await expect(overviewCommand().execute(revokedClientId, engagementId)).rejects.toMatchObject({
      category: 'notFound',
    });
    await expect(
      clientMediaAccessCommand().execute(revokedClientId, mediaId),
    ).rejects.toMatchObject({ category: 'notFound' });

    // Isolation: the engagement and a DIFFERENT client on it are unaffected.
    await expect(overviewCommand().execute(otherClientId, engagementId)).resolves.toBeDefined();
    await expect(clientMediaAccessCommand().execute(otherClientId, mediaId)).resolves.toBeDefined();
  });
});
