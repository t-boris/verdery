/**
 * Full HTTP-level contract tests for the P9C-API-01 client-portal routes —
 * the real Fastify application (`buildTestApplication`), the real
 * authentication plugin, a real migrated PostgreSQL database, and the fake
 * `MediaStorageGateway`/Firebase boundary only. Mirrors `media-routes.test
 * .ts`'s own structure exactly.
 *
 * Transport-layer coverage only (path parameter wiring, status codes,
 * response shape) — the authorization business logic (concealment,
 * honest-absence, withdrawn-exclusion, ordering) is already covered
 * exhaustively at the command level by `tests/integration/client-portal
 * .test.ts`. This suite additionally proves the one thing that level
 * cannot: that `GET /client/publications/{publicationId}/media/{mediaId}
 * /access` genuinely delegates to `GetClientMediaAccess` (P9C-MEDIA-01)
 * through the real route, not merely through a direct command call.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `ClientPortal`;
 * implementation-plan.md work package P9C-API-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { insertGarden, insertProfile, insertRow } from '../support/collaboration-fixtures.js';
import {
  insertClientAccessGrant,
  insertClientEngagement,
} from '../support/service-organization-fixtures.js';
import {
  insertMediaEntitlement,
  insertPublicationGardenSnapshotDetail,
  insertPublicationItem,
  insertPublicationVersion,
  insertPublishedClientUpdate,
} from '../support/client-publication-fixtures.js';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import type {
  ApiError,
  ClientGardenListResult,
  ClientGardenOverview,
  MediaAccess,
} from '@verdery/api-contracts';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function asGardens(response: InjectResponse): ClientGardenListResult {
  return response.json<ClientGardenListResult>();
}

function asOverview(response: InjectResponse): ClientGardenOverview {
  return response.json<ClientGardenOverview>();
}

function asMediaAccess(response: InjectResponse): MediaAccess {
  return response.json<MediaAccess>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'client portal routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const JUNE = new Date('2026-06-01T09:00:00Z');

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents — the identical fixture every other HTTP suite in this codebase defines locally. */
class FakeTokenVerifier implements TokenVerifier {
  private readonly credentialsByToken = new Map<string, VerifiedCredential>();

  registerIdToken(token: string, firebaseUid: string): void {
    this.credentialsByToken.set(token, {
      firebaseUid,
      signInProvider: 'google.com',
      providerUid: firebaseUid,
      authenticatedAt: new Date(),
      email: `${firebaseUid}@example.com`,
      emailVerified: true,
    });
  }

  verifyIdToken(idToken: string): Promise<VerifiedCredential> {
    const credential = this.credentialsByToken.get(idToken);
    if (credential === undefined) {
      return Promise.reject(new Error('unknown test token'));
    }
    return Promise.resolve(credential);
  }

  createSessionCookie(): Promise<string> {
    return Promise.reject(new Error('not used by this suite'));
  }

  verifySessionCookie(sessionCookie: string): Promise<VerifiedCredential> {
    return this.verifyIdToken(sessionCookie);
  }

  revokeRefreshTokens(): Promise<void> {
    return Promise.resolve();
  }
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let pgClient: pg.Client;
  let tokenVerifier: FakeTokenVerifier;
  let app: FastifyInstance;

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

    pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });

    pgClient = new pg.Client({ connectionString: databaseUrl });
    await pgClient.connect();

    const database: DatabaseGateway = {
      queries: db,
      ping: () => Promise.resolve(),
      close: () => db.destroy(),
    };

    tokenVerifier = new FakeTokenVerifier();
    app = await buildTestApplication({
      database,
      tokenVerifier,
      mediaStorageGateway: new FakeMediaStorageGateway(),
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pgClient.end();
    await db.destroy();
    await container?.stop();
  });

  function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  /**
   * Pre-inserts a real `identity_access.profile` row with `insertProfile`'s
   * own `firebase-${id}` convention, then registers that SAME firebase_uid
   * with the fake token verifier — `ProvisionProfile`'s `findByFirebaseUid`
   * resolves the bearer token to THIS exact, already-known profile id,
   * rather than auto-provisioning a fresh one this test could not predict.
   */
  async function registerKnownProfile(): Promise<{ token: string; profileId: string }> {
    const profileId = await insertProfile(pgClient);
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, `firebase-${profileId}`);
    return { token, profileId };
  }

  /**
   * A real, active engagement with a real, active grant for a fresh, known
   * client profile. `engagementId` is generated as a real UUIDv7
   * (`generateUuidV7`), NOT the fixture's own default `randomUUID()`
   * (UUIDv4): `requireClientGardenId` reuses `UUID_PATTERN`
   * (`gardens-mapping/transport/garden-routes.ts`), which accepts only the
   * product's real v7 identifier shape — every id this codebase's own
   * commands generate is v7, so a route path parameter must be one too for
   * anything past a `400` to be reachable at all.
   */
  async function seedActiveClientGarden(gardenName = 'HTTP Test Garden') {
    const staffId = await insertProfile(pgClient);
    const { token, profileId: clientProfileId } = await registerKnownProfile();
    const gardenId = await insertGarden(pgClient, staffId);
    await pgClient.query(`UPDATE gardens_mapping.garden SET name = $1 WHERE id = $2`, [
      gardenName,
      gardenId,
    ]);
    const engagementId = await insertClientEngagement(pgClient, gardenId, staffId, {
      id: generateUuidV7(),
      state: 'active',
      activated_at: JUNE,
    });
    await insertClientAccessGrant(pgClient, engagementId, {
      client_profile_id: clientProfileId,
      state: 'active',
      granted_at: JUNE,
    });

    return { token, staffId, clientProfileId, gardenId, engagementId };
  }

  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/client/gardens' });

    expect(response.statusCode).toBe(401);
  });

  it("lists the caller's own client-portal gardens", async () => {
    const client = await seedActiveClientGarden('Willow Court');

    const response = await app.inject({
      method: 'GET',
      url: '/v1/client/gardens',
      headers: bearer(client.token),
    });

    expect(response.statusCode).toBe(200);
    expect(asGardens(response).items).toEqual([{ id: client.engagementId, name: 'Willow Court' }]);
  });

  it('returns an honest-absence overview, then the published snapshot once one exists', async () => {
    const client = await seedActiveClientGarden();

    const emptyResponse = await app.inject({
      method: 'GET',
      url: `/v1/client/gardens/${client.engagementId}/overview`,
      headers: bearer(client.token),
    });
    expect(emptyResponse.statusCode).toBe(200);
    expect(asOverview(emptyResponse)).toEqual({ clientGardenId: client.engagementId });

    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      client.engagementId,
      client.gardenId,
      client.staffId,
      client.staffId,
    );
    const publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      client.engagementId,
      client.gardenId,
      client.staffId,
    );
    const snapshotItemId = await insertPublicationItem(
      pgClient,
      publicationVersionId,
      client.gardenId,
      'garden_snapshot',
      { occurred_at: JUNE },
    );
    await insertPublicationGardenSnapshotDetail(pgClient, snapshotItemId, {
      overview_text: 'Four beds, one greenhouse.',
    });

    const filledResponse = await app.inject({
      method: 'GET',
      url: `/v1/client/gardens/${client.engagementId}/overview`,
      headers: bearer(client.token),
    });
    expect(filledResponse.statusCode).toBe(200);
    const overview = asOverview(filledResponse);
    expect(overview.publicationId).toBe(publicationVersionId);
    expect(overview.overviewText).toBe('Four beds, one greenhouse.');
  });

  it('returns 404 for a clientGardenId the caller holds no grant on — identical to a garbage id', async () => {
    const clientA = await seedActiveClientGarden();
    const clientB = await seedActiveClientGarden();
    // A well-formed but nonexistent id — same v7 shape `requireClientGardenId`
    // requires, so this genuinely reaches the concealed-not-found path
    // rather than being rejected earlier as malformed input.
    const garbageId = generateUuidV7();

    const forOthersEngagement = await app.inject({
      method: 'GET',
      url: `/v1/client/gardens/${clientA.engagementId}/publications`,
      headers: bearer(clientB.token),
    });
    const forGarbageId = await app.inject({
      method: 'GET',
      url: `/v1/client/gardens/${garbageId}/publications`,
      headers: bearer(clientB.token),
    });

    expect(forOthersEngagement.statusCode).toBe(404);
    expect(forGarbageId.statusCode).toBe(404);
    expect(asError(forOthersEngagement).error.code).toBe('client_portal.not_found');
    expect(asError(forOthersEngagement).error.code).toBe(asError(forGarbageId).error.code);
  });

  it('the media-access route delegates to GetClientMediaAccess: an entitled media id succeeds, an unentitled one is denied', async () => {
    const client = await seedActiveClientGarden();
    const clientUpdateId = await insertPublishedClientUpdate(
      pgClient,
      client.engagementId,
      client.gardenId,
      client.staffId,
      client.staffId,
    );
    const publicationVersionId = await insertPublicationVersion(
      pgClient,
      clientUpdateId,
      client.engagementId,
      client.gardenId,
      client.staffId,
    );
    // `insertMediaRecord` (client-publication-fixtures.ts) always mints its
    // own v4 id internally and does not honor an `id` override in its
    // return value, so this test inserts the row directly with a real v7
    // id it can then also use, unmodified, as the route's own `{mediaId}`.
    const mediaRecordId = generateUuidV7();
    await insertRow(pgClient, 'media.media_record', {
      id: mediaRecordId,
      uploaded_by_profile_id: client.staffId,
      media_class: 'garden_photo',
      display_filename: 'north-bed.jpg',
      declared_content_type: 'image/jpeg',
      declared_byte_size: 2048,
      upload_state: 'available',
      sensitivity_classification: 'standard',
      garden_id: client.gardenId,
      bucket_name: 'test-user-media',
      object_key: `ab/http-client-portal/${mediaRecordId}`,
      processing_state: 'processed',
    });
    await insertMediaEntitlement(
      pgClient,
      client.engagementId,
      publicationVersionId,
      mediaRecordId,
    );
    const unentitledMediaRecordId = generateUuidV7();
    await insertRow(pgClient, 'media.media_record', {
      id: unentitledMediaRecordId,
      uploaded_by_profile_id: client.staffId,
      media_class: 'garden_photo',
      display_filename: 'north-bed.jpg',
      declared_content_type: 'image/jpeg',
      declared_byte_size: 2048,
      upload_state: 'available',
      sensitivity_classification: 'standard',
      garden_id: client.gardenId,
      bucket_name: 'test-user-media',
      object_key: `ab/http-client-portal/${unentitledMediaRecordId}`,
      processing_state: 'processed',
    });

    const entitledResponse = await app.inject({
      method: 'GET',
      // `publicationId` is validated only, never used as authority — a
      // mismatched value here (a fresh, well-formed id, not
      // `publicationVersionId`) still succeeds, proving the route's own
      // documented posture.
      url: `/v1/client/publications/${generateUuidV7()}/media/${mediaRecordId}/access`,
      headers: bearer(client.token),
    });
    expect(entitledResponse.statusCode).toBe(200);
    expect(asMediaAccess(entitledResponse).url).toBeTruthy();

    const unentitledResponse = await app.inject({
      method: 'GET',
      url: `/v1/client/publications/${generateUuidV7()}/media/${unentitledMediaRecordId}/access`,
      headers: bearer(client.token),
    });
    expect(unentitledResponse.statusCode).toBe(404);

    const malformedResponse = await app.inject({
      method: 'GET',
      url: `/v1/client/publications/not-a-uuid/media/${mediaRecordId}/access`,
      headers: bearer(client.token),
    });
    expect(malformedResponse.statusCode).toBe(400);
  });
});
