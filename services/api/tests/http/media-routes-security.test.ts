/**
 * P6-QA-01's HTTP-level security and malformed-input evidence for the media
 * routes, split out of `media-routes.test.ts` for the repository's 600-line
 * file rule (the same split reasoning Stage 11's oversized test files
 * document): a member of a DIFFERENT garden is concealed per endpoint, and
 * every malformed request family is a 400-shaped rejection, never a 500.
 * Same harness as `media-routes.test.ts` — real Fastify, real
 * authentication plugin, real migrated PostgreSQL; only Cloud Storage and
 * the Firebase boundary are faked.
 *
 * Source: architecture/media-storage-and-processing.md, sections
 * "18. Security" and "20. Testing" ("Unauthorized cross-garden access");
 * implementation-plan.md work package P6-QA-01.
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

function asMediaUploadSession(response: InjectResponse): MediaUploadSession {
  return response.json<MediaUploadSession>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'media routes security and malformed inputs (HTTP)';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents — `media-routes.test.ts`'s own fake. */
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
    app = await buildTestApplication({
      database,
      tokenVerifier,
      mediaStorageGateway: new FakeMediaStorageGateway({
        objectMetadata: { contentType: 'image/jpeg', sizeBytes: 123_456 },
      }),
    });
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
      payload: { name: 'Media Security Test Garden' },
    });

    return { token, garden: created.json<GardenResource>() };
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

  it('conceals garden A`s media from a member of garden B only, per endpoint: list, complete, access, delete all answer 404', async () => {
    // The caller is a real, authenticated member — just of a DIFFERENT
    // garden. Every garden-scoped media endpoint must conceal garden A
    // entirely (garden.not_found, per the authorization concealment rule),
    // not reveal that the garden or its media exist.
    const { token: ownerToken, garden } = await createGardenAsOwner();
    const registered = asMediaUploadSession(await registerUpload(ownerToken, garden.id));

    const { token: strangerToken } = await createGardenAsOwner();

    const list = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media`,
      headers: bearer(strangerToken),
    });
    expect(list.statusCode).toBe(404);
    expect(asError(list).error.code).toBe('garden.not_found');

    const complete = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/complete`,
      headers: {
        ...bearer(strangerToken),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(registered.media.revision)}"`,
      },
    });
    expect(complete.statusCode).toBe(404);
    expect(asError(complete).error.code).toBe('garden.not_found');

    const access = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/access`,
      headers: bearer(strangerToken),
    });
    expect(access.statusCode).toBe(404);
    expect(asError(access).error.code).toBe('garden.not_found');

    const deletion = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/delete`,
      headers: {
        ...bearer(strangerToken),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(registered.media.revision)}"`,
      },
    });
    expect(deletion.statusCode).toBe(404);
    expect(asError(deletion).error.code).toBe('garden.not_found');

    // None of the attempts moved the record.
    const status = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}`,
      headers: bearer(ownerToken),
    });
    expect(status.json<Media>().uploadState).toBe('authorized');
  });

  it('rejects malformed registration bodies with 400, never 500: negative size, bad checksum, oversized filename', async () => {
    const { token, garden } = await createGardenAsOwner();

    const negativeSize = await registerUpload(token, garden.id, {
      ...REGISTER_BODY,
      declaredByteSize: -1,
    });
    expect(negativeSize.statusCode).toBe(400);
    expect(asError(negativeSize).error.details?.[0]?.code).toBe(
      'request.declared_byte_size.invalid',
    );

    const fractionalSize = await registerUpload(token, garden.id, {
      ...REGISTER_BODY,
      declaredByteSize: 1.5,
    });
    expect(fractionalSize.statusCode).toBe(400);

    const badChecksum = await registerUpload(token, garden.id, {
      ...REGISTER_BODY,
      checksumSha256: 'NOT-HEX',
    });
    expect(badChecksum.statusCode).toBe(400);
    expect(asError(badChecksum).error.details?.[0]?.code).toBe('request.checksum_sha256.invalid');

    const oversizedFilename = await registerUpload(token, garden.id, {
      ...REGISTER_BODY,
      displayFilename: 'a'.repeat(256),
    });
    expect(oversizedFilename.statusCode).toBe(400);
    expect(asError(oversizedFilename).error.details?.[0]?.code).toBe(
      'request.display_filename.invalid',
    );
  });

  it('rejects a non-UUID mediaId, an out-of-range limit, and a malformed If-Match with 400, never 500', async () => {
    const { token, garden } = await createGardenAsOwner();
    const registered = asMediaUploadSession(await registerUpload(token, garden.id));

    const badMediaId = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/media/not-a-uuid`,
      headers: bearer(token),
    });
    expect(badMediaId.statusCode).toBe(400);
    expect(asError(badMediaId).error.details?.[0]?.code).toBe('request.media_id.invalid');

    for (const limit of ['0', '101', 'many']) {
      const badLimit = await app.inject({
        method: 'GET',
        url: `/v1/gardens/${garden.id}/media?limit=${limit}`,
        headers: bearer(token),
      });
      expect(badLimit.statusCode).toBe(400);
      expect(asError(badLimit).error.details?.[0]?.code).toBe('request.limit.invalid');
    }

    const badIfMatch = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/media/${registered.media.id}/complete`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': '"latest"',
      },
    });
    expect(badIfMatch.statusCode).toBe(400);
    expect(asError(badIfMatch).error.details?.[0]?.code).toBe('request.if_match.invalid');
  });
});
