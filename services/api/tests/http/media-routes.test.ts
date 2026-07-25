/**
 * Full HTTP-level contract tests for the media routes: the real Fastify
 * application, the real authentication plugin, a real migrated PostgreSQL
 * database, and the fake `MediaStorageGateway` (see
 * `buildTestApplication`'s own default) — only Cloud Storage and the
 * Firebase Admin SDK boundary are faked. Mirrors `plant-routes.test.ts`'s
 * own structure and conventions exactly.
 *
 * Transport-layer coverage only (request parsing, status codes, response
 * shape, header handling) — the business logic each command implements is
 * already covered by `tests/integration/media-upload-flow.test.ts`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Media`;
 * implementation-plan.md work package P6-API-01.
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import type {
  ApiError,
  Garden as GardenResource,
  Media,
  MediaAccess,
  MediaListResult,
  MediaUploadSession,
} from '@verdery/api-contracts';
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function asGarden(response: InjectResponse): GardenResource {
  return response.json<GardenResource>();
}

function asMediaUploadSession(response: InjectResponse): MediaUploadSession {
  return response.json<MediaUploadSession>();
}

function asMedia(response: InjectResponse): Media {
  return response.json<Media>();
}

function asMediaAccess(response: InjectResponse): MediaAccess {
  return response.json<MediaAccess>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'media routes (HTTP)';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents. */
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

const REGISTER_BODY = {
  mediaClass: 'garden_photo',
  displayFilename: 'photo.jpg',
  declaredContentType: 'image/jpeg',
  declaredByteSize: 123_456,
};

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let tokenVerifier: FakeTokenVerifier;
  let mediaStorageGateway: FakeMediaStorageGateway;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGIS_IMAGE).withPlatform(POSTGIS_PLATFORM).start();
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

    const database: DatabaseGateway = {
      queries: db,
      ping: () => Promise.resolve(),
      close: () => db.destroy(),
    };

    tokenVerifier = new FakeTokenVerifier();
    mediaStorageGateway = new FakeMediaStorageGateway({
      objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
    });
    app = await buildTestApplication({ database, tokenVerifier, mediaStorageGateway });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Media Test Garden' },
    });

    return { token, garden: asGarden(created) };
  }

  async function registerUpload(
    token: string,
    gardenId: string,
    body: Record<string, unknown> = REGISTER_BODY,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/media`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: body,
    });
  }

  it('rejects registration missing the Idempotency-Key header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media`,
      headers: bearer(token),
      payload: REGISTER_BODY,
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects registration with an unknown mediaClass with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await registerUpload(token, garden.id, {
      ...REGISTER_BODY,
      mediaClass: 'not_a_real_class',
    });

    expect(response.statusCode).toBe(400);
  });

  it('registers a media upload over real HTTP and returns 201 with the upload session', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await registerUpload(token, garden.id);

    expect(response.statusCode).toBe(201);
    const session = asMediaUploadSession(response);
    expect(session.media).toMatchObject({
      gardenId: garden.id,
      mediaClass: 'garden_photo',
      uploadState: 'authorized',
    });
    expect(session.uploadUrl).toContain('http');
  });

  it('completes an upload over real HTTP with If-Match, and reads it back through status and access', async () => {
    const { token, garden } = await createGardenAsOwner();
    const registered = asMediaUploadSession(await registerUpload(token, garden.id));

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/complete`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(registered.media.revision)}"`,
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(asMedia(completed).uploadState).toBe('available');

    const status = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}`,
      headers: bearer(token),
    });
    expect(status.statusCode).toBe(200);
    expect(asMedia(status).uploadState).toBe('available');

    // The real validation worker owns this transition. This HTTP transport
    // suite does not run services/workers, so seed its successful outcome.
    await db
      .updateTable('media.media_record')
      .set({ processing_state: 'processed' })
      .where('id', '=', registered.media.id)
      .execute();

    const access = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/access`,
      headers: bearer(token),
    });
    expect(access.statusCode).toBe(200);
    expect(asMediaAccess(access).url).toContain('http');
  });

  it('rejects completion missing the If-Match header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();
    const registered = asMediaUploadSession(await registerUpload(token, garden.id));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/complete`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
    });

    expect(response.statusCode).toBe(400);
  });

  it('lists a garden`s media over real HTTP, filtered by class, most recent first (P6-PLAN-01)', async () => {
    const { token, garden } = await createGardenAsOwner();
    await registerUpload(token, garden.id);
    const plan = asMediaUploadSession(
      await registerUpload(token, garden.id, {
        mediaClass: 'imported_plan',
        displayFilename: 'plan.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      }),
    );

    const unfiltered = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media`,
      headers: bearer(token),
    });
    expect(unfiltered.statusCode).toBe(200);
    expect(unfiltered.json<MediaListResult>().items).toHaveLength(2);

    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media?mediaClass=imported_plan`,
      headers: bearer(token),
    });
    expect(filtered.statusCode).toBe(200);
    const filteredResult = filtered.json<MediaListResult>();
    expect(filteredResult.items).toHaveLength(1);
    expect(filteredResult.items[0]).toMatchObject({
      id: plan.media.id,
      mediaClass: 'imported_plan',
      derivatives: [],
    });
  });

  it('rejects listing with an unknown mediaClass filter with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media?mediaClass=not_a_real_class`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(400);
  });

  it('conceals media that exists but belongs to a different garden as the identical 404', async () => {
    const { token: otherToken, garden: otherGarden } = await createGardenAsOwner();
    const foreignSession = asMediaUploadSession(await registerUpload(otherToken, otherGarden.id));

    const { token, garden } = await createGardenAsOwner();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media/${foreignSession.media.id}`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('media.not_found');
  });

  it('returns 404 for a media id that does not exist in an owned garden', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media/${generateUuidV7()}`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('media.not_found');
  });

  it('deletes media over real HTTP with If-Match, returning the deletion_scheduled record (P6-RET-01)', async () => {
    const { token, garden } = await createGardenAsOwner();
    const registered = asMediaUploadSession(await registerUpload(token, garden.id));
    const completed = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/complete`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(registered.media.revision)}"`,
      },
    });
    const available = asMedia(completed);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/delete`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(available.revision)}"`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(asMedia(response).uploadState).toBe('deletion_scheduled');
  });

  it('rejects deletion missing the If-Match header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();
    const registered = asMediaUploadSession(await registerUpload(token, garden.id));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/delete`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
    });

    expect(response.statusCode).toBe(400);
  });

  it('serves the retention policy to any authenticated caller, raw-capture declared but not enforced (P6-RET-01)', async () => {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const response = await app.inject({
      method: 'GET',
      url: '/v1/media/retention-policy',
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    const result = response.json<{
      policies: { mediaClass: string; retentionDays: number | null; enforced: boolean }[];
    }>();
    expect(result.policies).toHaveLength(6);
    expect(result.policies.find((policy) => policy.mediaClass === 'raw_capture')).toMatchObject({
      retentionDays: 30,
      enforced: false,
    });
    expect(result.policies.find((policy) => policy.mediaClass === 'export_package')).toMatchObject({
      retentionDays: 7,
      enforced: true,
    });
  });

  it('rejects an unauthenticated retention-policy read with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/media/retention-policy' });

    expect(response.statusCode).toBe(401);
  });
});
