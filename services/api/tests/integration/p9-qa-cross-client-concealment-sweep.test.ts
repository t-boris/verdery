/**
 * P9-QA-01 (Batch A), matrix 4 — THE CROSS-CLIENT CONCEALMENT SWEEP.
 *
 * `client-portal.test.ts` already proves, per route, that a garbage
 * `clientGardenId` and client B's REAL, active engagement produce the
 * IDENTICAL concealed response for `overview`/`publications`/`timeline`;
 * `client-media-access-denial-matrix.test.ts` proves the identical thing for
 * media. This file does not re-prove any one of those in isolation — its
 * value is sweeping the SAME two clients (A and B, two distinct, unrelated
 * engagements) across EVERY client-facing route AT ONCE, asserting the
 * actual `{ category, code, message }` triples are byte-identical between
 * "this id never existed" and "this id belongs to client A, not you" — not
 * merely that both happen to be some flavor of 404.
 *
 * SIX ROUTES, PER THE PACKAGE'S OWN ENUMERATION: portal overview, portal
 * publications, portal timeline, client media access, client export
 * manifest, and client invitation accept. The first five are proven
 * byte-identical below. The sixth is NOT, and this file says so directly
 * rather than forcing it to fit: `AcceptClientInvitation` conceals an
 * UNKNOWN token as `notFound` (`client_access_grant.not_found`) but raises a
 * DISTINCT `forbidden` (`client_access_grant.email_mismatch`) for a REAL
 * token whose bound email does not match the caller's — a structurally
 * different envelope (different HTTP category, different code, different
 * message). This is read directly from `domain/client-access-grant.ts#
 * assertClientEmailBindingSatisfied`, not assumed, and reported here exactly
 * as observed: unlike the other five routes, which conceal existence behind
 * one universal not-found, reaching this specific divergence already
 * requires possessing client A's own real, secret invitation token (an
 * unguessable value, unlike a `clientGardenId`/`mediaId`, which are
 * plausible for any authenticated client to probe) — architecture/
 * collaboration-and-client-sharing.md section 20 lists "Email mismatch" as
 * its OWN required failure behavior, distinct from generic concealment. This
 * divergence is flagged for human review, not silently treated as a bug or
 * silently ignored.
 *
 * Source: implementation-plan.md work packages P9C-API-01, P9C-MEDIA-01,
 * P9C-EXPORT-01, P9C-INVITE-01; architecture/collaboration-and-client-
 * sharing.md, sections "13. API Surfaces", "20. Failure and Concurrency
 * Behavior", "24. Completion Criteria" ("Internal resources cannot be
 * enumerated through client routes...").
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import {
  AcceptClientInvitation,
  ClientPortalAuthorization,
  GetClientGardenOverview,
  GetClientTimeline,
  hashClientInvitationToken,
  KyselyClientAccessGrantRepository,
  KyselyClientEngagementRepository,
  KyselyClientPublicationReadRepository,
  KyselyCollaborationUnitOfWork,
  ListClientPublications,
} from '../../src/modules/collaboration/public.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import {
  GetClientMediaAccess,
  KyselyClientMediaEntitlementSource,
  KyselyMediaRepository,
} from '../../src/modules/media/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyAuditLogger } from '../../src/platform/audit/kysely-audit-logger.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile } from '../support/collaboration-fixtures.js';
import {
  insertClientAccessGrant,
  insertClientEngagement,
} from '../support/service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertMediaRecord,
  insertPublicationGardenSnapshotDetail,
  insertPublicationItem,
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';
import { buildGetClientExportManifest } from '../support/client-export-test-harness.js';

const SUITE_NAME = 'p9-qa: cross-client concealment sweep';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const NOW = new Date('2026-07-21T09:00:00Z');
const GARBAGE_ID = '00000000-0000-4000-8000-000000000000';

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

interface ErrorShape {
  readonly category: unknown;
  readonly code: unknown;
  readonly message: unknown;
}

async function captureError(promise: Promise<unknown>): Promise<ErrorShape> {
  try {
    await promise;
  } catch (error) {
    const err = error as { category?: unknown; code?: unknown; message?: unknown };
    return { category: err.category, code: err.code, message: err.message };
  }
  throw new Error('expected the call to reject, but it resolved');
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

  function portalAuthorization(): ClientPortalAuthorization {
    return new ClientPortalAuthorization(
      new KyselyClientAccessGrantRepository(db),
      new KyselyClientEngagementRepository(db),
    );
  }

  /** A complete, genuinely valid, entitled client scenario — client A and client B (built twice) are each fully real, active, and unrelated to one another. */
  async function seedEntitledClient() {
    const staffId = await insertProfile(pgClient);
    const clientProfileId = await insertProfile(pgClient);
    const gardenId = await insertGarden(pgClient, staffId);
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
    const snapshotItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      gardenId,
      'garden_snapshot',
    );
    await insertPublicationGardenSnapshotDetail(pgClient, snapshotItemId);

    const mediaId = await insertMediaRecord(pgClient, staffId, {
      garden_id: gardenId,
      processing_state: 'processed',
      bucket_name: 'test-user-media',
      object_key: `ab/p9-qa-concealment/${randomUUID()}`,
    });
    await insertMediaEntitlement(pgClient, engagementId, publicationVersionId, mediaId);

    return { staffId, clientProfileId, gardenId, engagementId, mediaId };
  }

  /** A real, pending (never accepted) client invitation with a KNOWN raw token — client A's own, held by nobody but them. */
  async function seedPendingInvitation(engagementId: string, invitedEmail: string) {
    const token = randomUUID();
    await pgClient.query(
      `INSERT INTO collaboration.client_access_grant
         (id, engagement_id, invited_email, token_hash, state, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
      [
        randomUUID(),
        engagementId,
        invitedEmail,
        hashClientInvitationToken(token),
        new Date('2026-08-01T09:00:00Z'),
        NOW,
      ],
    );
    return token;
  }

  it('portal overview/publications/timeline: garbage id vs. client A’s real engagement are byte-identical for client B', async () => {
    const clientA = await seedEntitledClient();
    const clientB = await seedEntitledClient();

    const overview = new GetClientGardenOverview(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );
    const publications = new ListClientPublications(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );
    const timeline = new GetClientTimeline(
      portalAuthorization(),
      new KyselyClientPublicationReadRepository(db),
    );

    for (const route of [overview, publications, timeline]) {
      const unknown = await captureError(route.execute(clientB.clientProfileId, GARBAGE_ID));
      const foreign = await captureError(
        route.execute(clientB.clientProfileId, clientA.engagementId),
      );
      expect(foreign).toEqual(unknown);
      // Client B's OWN engagement is unaffected — the denial is real, not a
      // global block on client B.
      await expect(
        route.execute(clientB.clientProfileId, clientB.engagementId),
      ).resolves.toBeDefined();
    }
  });

  it('client media access: garbage id vs. client A’s real, entitled media are byte-identical for client B', async () => {
    const clientA = await seedEntitledClient();
    const clientB = await seedEntitledClient();
    const clientMediaAccess = new GetClientMediaAccess(
      new KyselyMediaRepository(db),
      new KyselyClientMediaEntitlementSource(db),
      new FakeMediaStorageGateway(),
      new KyselyAuditLogger(db, fixedClock(NOW)),
      fixedClock(NOW),
    );

    const unknown = await captureError(
      clientMediaAccess.execute(clientB.clientProfileId, GARBAGE_ID),
    );
    const foreign = await captureError(
      clientMediaAccess.execute(clientB.clientProfileId, clientA.mediaId),
    );
    expect(foreign).toEqual(unknown);
    await expect(
      clientMediaAccess.execute(clientB.clientProfileId, clientB.mediaId),
    ).resolves.toBeDefined();
  });

  it('client export manifest: garbage id vs. client A’s real engagement are byte-identical for client B', async () => {
    const clientA = await seedEntitledClient();
    const clientB = await seedEntitledClient();
    const exportManifest = buildGetClientExportManifest(db, fixedClock(NOW));

    const unknown = await captureError(exportManifest.execute(clientB.clientProfileId, GARBAGE_ID));
    const foreign = await captureError(
      exportManifest.execute(clientB.clientProfileId, clientA.engagementId),
    );
    expect(foreign).toEqual(unknown);
    await expect(
      exportManifest.execute(clientB.clientProfileId, clientB.engagementId),
    ).resolves.toBeDefined();
  });

  it('client invitation accept: an UNKNOWN token is concealed as notFound — the baseline every other route matches', async () => {
    const clientB = await seedEntitledClient();
    const acceptInvitation = new AcceptClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(NOW)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(NOW)),
      fixedClock(NOW),
    );

    const unknown = await captureError(
      acceptInvitation.execute(
        { profileId: clientB.clientProfileId, email: 'client-b@example.test', emailVerified: true },
        randomUUID(),
        randomUUID(),
      ),
    );
    expect(unknown).toMatchObject({
      category: 'notFound',
      code: 'client_access_grant.not_found',
    });
  });

  it('client invitation accept: a REAL token addressed to client A is NOT concealed the same way — a distinct, DIFFERENT-shaped forbidden/email-mismatch response, unlike the other five routes (flagged, not silently normalized)', async () => {
    const clientA = await seedEntitledClient();
    const clientB = await seedEntitledClient();
    const acceptInvitation = new AcceptClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(NOW)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(NOW)),
      fixedClock(NOW),
    );

    // A genuinely real, pending token — client A's own, addressed to their
    // own email — attempted by client B, whose verified email differs.
    const clientAsOwnToken = await seedPendingInvitation(
      clientA.engagementId,
      'client-a@example.test',
    );
    const unknown = await captureError(
      acceptInvitation.execute(
        { profileId: clientB.clientProfileId, email: 'client-b@example.test', emailVerified: true },
        randomUUID(),
        randomUUID(),
      ),
    );
    const foreign = await captureError(
      acceptInvitation.execute(
        { profileId: clientB.clientProfileId, email: 'client-b@example.test', emailVerified: true },
        clientAsOwnToken,
        randomUUID(),
      ),
    );

    // The point of this test: these are NOT equal, unlike every other route
    // in this sweep — `unknown` is a concealed 404, `foreign` is a distinct
    // 403 that confirms the token is real (see this file's own header).
    expect(unknown).not.toEqual(foreign);
    expect(unknown).toMatchObject({ category: 'notFound', code: 'client_access_grant.not_found' });
    expect(foreign).toMatchObject({
      category: 'forbidden',
      code: 'client_access_grant.email_mismatch',
    });
  });
});
