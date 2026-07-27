/**
 * P9-QA-01 (Batch A), matrix 3 — THE FULL CLIENT-ENGAGEMENT LIFECYCLE,
 * CHAINED END TO END.
 *
 * Every command exercised below already has its own isolated proof: engagement
 * creation/activation (`collaboration-client-engagements.test.ts`), the
 * invite/accept mechanism (`collaboration-client-invitations.test.ts`,
 * `collaboration-accept-client-invitation.test.ts`), the publish state
 * machine (`collaboration-publications.test.ts`), and revocation
 * (`client-export-manifest-lifecycle.test.ts`, `client-portal.test.ts`). This
 * file's reason to exist is refusing to bypass ANY of those steps with a
 * direct-row fixture the way each of those suites deliberately does for
 * everything OTHER than its own one unit under test — here, every step is a
 * REAL command, in the REAL order a professional and a client actually live
 * through: create an engagement, invite a client (through the real email
 * adapter, extracting the real accept token the same way a client's inbox
 * would), accept it, publish an update with media, read it back through
 * every portal surface AND the media route, withdraw it, and finally revoke
 * the engagement — proving the client is locked out of portal, media, AND
 * export TOGETHER, in the same chained state, not as three separate
 * assumptions.
 *
 * Source: implementation-plan.md work packages P9C-INVITE-01, P9C-PUBLISH-01,
 * P9C-API-01, P9C-MEDIA-01, P9C-EXPORT-01; architecture/collaboration-and-
 * client-sharing.md, sections "9. Client Invitation and Session",
 * "10. Publication Workflow", "15. Synchronization and Revocation".
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
  AcceptClientInvitation,
  ActivateClientEngagement,
  AddClientUpdateItem,
  ClientPortalAuthorization,
  CreateClientEngagement,
  CreateClientInvitation,
  CreateClientUpdate,
  GetClientGardenOverview,
  GetClientTimeline,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyClientPublicationReadRepository,
  KyselyClientUpdateRepository,
  KyselyCollaborationUnitOfWork,
  KyselyOrganizationMembershipRepository,
  KyselyPublisherGrantRepository,
  KyselyWorkLogRepository,
  ListClientPublications,
  OrganizationAuthorization,
  PublisherAuthorization,
  PublishClientUpdate,
  RevokeClientEngagement,
  SubmitClientUpdate,
  UpdateClientUpdateContent,
  WithdrawClientUpdate,
} from '../../src/modules/collaboration/public.js';
import {
  GardenAuthorization,
  KyselyGardenRepository,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import { KyselyProfileRepository } from '../../src/modules/identity-access/public.js';
import { FakeTransactionalEmailAdapter } from '../../src/modules/integrations/application/integrations-test-doubles.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import {
  GetClientMediaAccess,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
} from '../../src/modules/media/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyAuditLogger } from '../../src/platform/audit/kysely-audit-logger.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertMediaRecord } from '../support/client-publication-fixtures.js';
import {
  fixedClock,
  insertGarden,
  insertMembership,
  insertProfile,
  insertPublisherGrant,
} from '../support/publication-integration-harness.js';
import { buildGetClientExportManifest } from '../support/client-export-test-harness.js';

const SUITE_NAME = 'p9-qa: client publication lifecycle, chained end to end';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');
const APRIL = new Date('2026-04-10T09:00:00Z');
const MAY = new Date('2026-05-10T09:00:00Z');
const JUNE = new Date('2026-06-10T09:00:00Z');
const CLIENT_PORTAL_BASE_URL = 'https://portal.verdery-test.example';
const CLIENT_EMAIL = 'client@example.test';

/** Extracts the real accept token embedded in the real invitation email — the same link a client's own inbox would carry. */
function extractAcceptToken(html: string): string {
  const match = /token=([^"&]+)/.exec(html);
  const rawToken = match?.[1];
  if (rawToken === undefined) {
    throw new Error('accept token not found in invitation email');
  }
  return decodeURIComponent(rawToken);
}

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

  function organizationAuthorization(): OrganizationAuthorization {
    return new OrganizationAuthorization(new KyselyOrganizationMembershipRepository(db));
  }

  function gardenAuthorization(): GardenAuthorization {
    return new GardenAuthorization(new KyselyMembershipRepository(db));
  }

  function engagements(): KyselyClientEngagementRepository {
    return new KyselyClientEngagementRepository(db);
  }

  function clientUpdates(): KyselyClientUpdateRepository {
    return new KyselyClientUpdateRepository(db);
  }

  function publisherAuthorization(): PublisherAuthorization {
    return new PublisherAuthorization(new KyselyPublisherGrantRepository(db));
  }

  function portalAuthorization(): ClientPortalAuthorization {
    return new ClientPortalAuthorization(
      new KyselyClientAccessGrantRepository(db),
      new KyselyClientEngagementRepository(db),
    );
  }

  it('create engagement -> invite -> accept -> publish (with media) -> client reads portal+media -> withdraw (portal goes dark) -> revoke (portal, media, AND export all locked out together)', async () => {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);

    // --- Step 1: create the engagement (real command) ---------------------
    const createEngagement = new CreateClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(JANUARY)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(JANUARY)),
      organizationAuthorization(),
      gardenAuthorization(),
      new KyselyGardenRepository(db),
      fixedClock(JANUARY),
    );
    const engagement = await createEngagement.execute({ gardenId }, ownerId, randomUUID());
    expect(engagement.state).toBe('draft');

    // --- Step 2: activate it (real command) --------------------------------
    const activateEngagement = new ActivateClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(JANUARY)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(JANUARY)),
      organizationAuthorization(),
      gardenAuthorization(),
      fixedClock(JANUARY),
    );
    const activated = await activateEngagement.execute(engagement.id, ownerId, randomUUID());
    expect(activated.state).toBe('active');
    await insertPublisherGrant(db, engagement.id, ownerId, ownerId, JANUARY);

    // --- Step 3: invite the client — a REAL email, through a real (fake
    // transport) adapter, never a directly-seeded grant row --------------
    const emailAdapter = new FakeTransactionalEmailAdapter();
    const createInvitation = new CreateClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      organizationAuthorization(),
      gardenAuthorization(),
      engagements(),
      new KyselyClientAccessGrantRepository(db),
      { adapter: emailAdapter, clientPortalBaseUrl: CLIENT_PORTAL_BASE_URL, callTimeoutMs: 1_000 },
      fixedClock(MARCH),
    );
    await createInvitation.execute(engagement.id, CLIENT_EMAIL, ownerId, randomUUID());
    expect(emailAdapter.callCount).toBe(1);
    const acceptToken = extractAcceptToken(emailAdapter.sentMessages[0]?.html ?? '');

    // --- Step 4: the client authenticates and accepts (real command) ------
    const clientProfileId = await insertProfile(db);
    const acceptInvitation = new AcceptClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      fixedClock(MARCH),
    );
    const grant = await acceptInvitation.execute(
      { profileId: clientProfileId, email: CLIENT_EMAIL, emailVerified: true },
      acceptToken,
      randomUUID(),
    );
    expect(grant.state).toBe('active');

    // Before any publication exists, the client's own portal is a real,
    // authorized, honest absence — not an error — proving their access is
    // genuinely live at this point in the chain.
    const overview = new GetClientGardenOverview(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );
    const overviewBeforePublish = await overview.execute(clientProfileId, engagement.id);
    expect(overviewBeforePublish.overviewText).toBeUndefined();

    // --- Step 5: publish an update WITH media (real command chain) --------
    const mediaId = await insertMediaRecord(pgClient, ownerId, {
      garden_id: gardenId,
      processing_state: 'processed',
      bucket_name: 'test-user-media',
      object_key: `ab/p9-qa-lifecycle/${randomUUID()}`,
    });

    const createUpdate = new CreateClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      fixedClock(APRIL),
    );
    const draft = await createUpdate.execute(
      engagement.id,
      'April visit summary',
      ownerId,
      randomUUID(),
    );

    const addItem = new AddClientUpdateItem(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      new KyselyWorkLogRepository(db),
      new KyselyMediaRepository(db),
      fixedClock(APRIL),
    );
    await addItem.execute(
      engagement.id,
      draft.id,
      {
        kind: 'media',
        occurredAt: APRIL,
        mediaRecordId: mediaId,
        mediaRole: 'after',
        caption: 'Beds refreshed',
      },
      ownerId,
      randomUUID(),
    );

    const updateContent = new UpdateClientUpdateContent(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(APRIL),
    );
    const withSummary = await updateContent.execute(
      engagement.id,
      draft.id,
      { summary: 'Spring beds refreshed across the garden.' },
      ownerId,
      draft.revision,
      randomUUID(),
    );

    const submit = new SubmitClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(APRIL),
    );
    const submitted = await submit.execute(
      engagement.id,
      draft.id,
      ownerId,
      withSummary.revision,
      randomUUID(),
    );

    const publish = new PublishClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(APRIL)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(APRIL)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      new KyselyMediaRepository(db),
      new KyselyProfileRepository(db),
      fixedClock(APRIL),
    );
    const published = await publish.execute(
      engagement.id,
      draft.id,
      {
        gardenSnapshot: {
          overviewText: 'Spring beds refreshed across the garden.',
          snapshotData: null,
        },
        timelineEntries: [{ entryText: 'April maintenance visit completed.', occurredAt: APRIL }],
        staffAttributions: [
          { staffProfileId: ownerId, displayName: 'Jordan Rivera', roleLabel: null },
        ],
      },
      ownerId,
      submitted.revision,
      randomUUID(),
    );
    expect(published.items.map((item) => item.kind).sort()).toEqual([
      'garden_snapshot',
      'media',
      'timeline_entry',
    ]);

    // --- Step 6: the client reads it via EVERY portal surface, AND the
    // media route --------------------------------------------------------
    const publications = new ListClientPublications(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );
    const timeline = new GetClientTimeline(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );
    const storage = new FakeMediaStorageGateway();
    const clientMediaAccess = new GetClientMediaAccess(
      new KyselyMediaRepository(db),
      new KyselyClientMediaEntitlementSource(db),
      storage,
      new KyselyAuditLogger(db, fixedClock(APRIL)),
      fixedClock(APRIL),
    );

    const overviewAfterPublish = await overview.execute(clientProfileId, engagement.id);
    expect(overviewAfterPublish.overviewText).toBe('Spring beds refreshed across the garden.');

    const publicationsAfterPublish = await publications.execute(clientProfileId, engagement.id);
    expect(publicationsAfterPublish.items).toHaveLength(1);
    expect(publicationsAfterPublish.items[0]?.id).toBe(published.id);

    const timelineAfterPublish = await timeline.execute(clientProfileId, engagement.id);
    expect(timelineAfterPublish.items.length).toBeGreaterThan(0);

    const mediaAccess = await clientMediaAccess.execute(clientProfileId, mediaId);
    expect(mediaAccess.url).toContain('test-user-media');
    expect(storage.createSignedUrlCalls).toHaveLength(1);

    // --- Step 7: withdraw — the client can no longer see it in the portal -
    const withdraw = new WithdrawClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(MAY)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MAY)),
      publisherAuthorization(),
      engagements(),
      clientUpdates(),
      fixedClock(MAY),
    );
    const clientUpdateAfterPublish = await clientUpdates().findById(draft.id);
    await withdraw.execute(
      engagement.id,
      draft.id,
      'Superseded by next visit',
      ownerId,
      clientUpdateAfterPublish?.revision as number,
      randomUUID(),
    );

    const overviewAfterWithdraw = await overview.execute(clientProfileId, engagement.id);
    expect(overviewAfterWithdraw.overviewText).toBeUndefined();
    const publicationsAfterWithdraw = await publications.execute(clientProfileId, engagement.id);
    expect(publicationsAfterWithdraw.items).toHaveLength(0);

    // --- Step 8: revoke the engagement entirely — ALL THREE surfaces
    // locked out together, in the same chained state --------------------
    const revokeEngagement = new RevokeClientEngagement(
      new KyselyIdempotencyStore(db, fixedClock(JUNE)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(JUNE)),
      organizationAuthorization(),
      gardenAuthorization(),
      fixedClock(JUNE),
    );
    const revoked = await revokeEngagement.execute(
      engagement.id,
      ownerId,
      'Engagement ended by client request',
      randomUUID(),
    );
    expect(revoked.state).toBe('revoked');

    // Portal: all three reads.
    await expect(overview.execute(clientProfileId, engagement.id)).rejects.toMatchObject({
      category: 'notFound',
    });
    await expect(publications.execute(clientProfileId, engagement.id)).rejects.toMatchObject({
      category: 'notFound',
    });
    await expect(timeline.execute(clientProfileId, engagement.id)).rejects.toMatchObject({
      category: 'notFound',
    });

    // Media.
    await expect(clientMediaAccess.execute(clientProfileId, mediaId)).rejects.toMatchObject({
      category: 'notFound',
    });

    // Export — revoked is NOT admitted even by the export widening that lets
    // an ENDED engagement stay reachable (`requireExportableGardenAccess`).
    const exportManifest = buildGetClientExportManifest(db, fixedClock(JUNE));
    await expect(exportManifest.execute(clientProfileId, engagement.id)).rejects.toMatchObject({
      category: 'notFound',
    });
  });
});
