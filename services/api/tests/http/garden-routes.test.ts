/**
 * Full HTTP-level contract tests for the garden routes: the real Fastify
 * application, the real authentication plugin, and a real migrated
 * PostgreSQL database — only the Firebase Admin SDK boundary is faked, since
 * a real Firebase project is not available in a test run.
 *
 * Source: architecture/api-design.md, section "23. Testing and Governance"
 * ("Route integration tests validate status, error, auth, idempotency, and
 * concurrency behavior"); implementation-plan.md work package P2-API-01.
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
import type { ApiError, Garden as GardenResource } from '@verdery/api-contracts';
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

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'garden routes (HTTP)';
const POSTGIS_IMAGE = 'postgis/postgis:17-3.5';
const POSTGIS_PLATFORM = 'linux/amd64';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token or session cookie directly to the credential it represents. */
class FakeTokenVerifier implements TokenVerifier {
  private readonly credentialsByToken = new Map<string, VerifiedCredential>();
  private sessionCounter = 0;

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

  createSessionCookie(idToken: string): Promise<string> {
    const credential = this.credentialsByToken.get(idToken);
    if (credential === undefined) {
      return Promise.reject(new Error('unknown test token'));
    }
    this.sessionCounter += 1;
    const sessionCookie = `session-${String(this.sessionCounter)}`;
    this.credentialsByToken.set(sessionCookie, credential);
    return Promise.resolve(sessionCookie);
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
    app = await buildTestApplication({ database, tokenVerifier });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/gardens' });
    expect(response.statusCode).toBe(401);
    expect(asError(response).error.code).toBe('auth.unauthenticated');
  });

  it('rejects garden creation missing the Idempotency-Key header with 400', async () => {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: bearer(token),
      payload: { name: 'Backyard' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('runs the full lifecycle over real HTTP: create, get, rename, archive, delete-request', async () => {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Backyard' },
    });
    expect(created.statusCode).toBe(201);
    const garden = asGarden(created);
    expect(garden).toMatchObject({
      name: 'Backyard',
      lifecycleState: 'active',
      callerRole: 'owner',
    });

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}`,
      headers: bearer(token),
    });
    expect(fetched.statusCode).toBe(200);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(garden.revision)}"`,
      },
      payload: { name: 'Front Yard' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(asGarden(renamed)).toMatchObject({ name: 'Front Yard', revision: garden.revision + 1 });

    const staleRename = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(garden.revision)}"`,
      },
      payload: { name: 'Yet Another Name' },
    });
    expect(staleRename.statusCode).toBe(412);
    expect(asError(staleRename).error.code).toBe('garden.stale_revision');

    const archived = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/archive`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(garden.revision + 1)}"`,
      },
    });
    expect(archived.statusCode).toBe(200);
    expect(asGarden(archived).lifecycleState).toBe('archived');

    const deletionRequested = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/delete-request`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(garden.revision + 2)}"`,
      },
    });
    expect(deletionRequested.statusCode).toBe(200);
    expect(asGarden(deletionRequested).lifecycleState).toBe('deletionRequested');
  });

  it('conceals a garden the caller has no membership on as 404', async () => {
    const ownerToken = randomUUID();
    const strangerToken = randomUUID();
    tokenVerifier.registerIdToken(ownerToken, randomUUID());
    tokenVerifier.registerIdToken(strangerToken, randomUUID());

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(ownerToken), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Owner Only' },
    });
    const garden = asGarden(created);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}`,
      headers: bearer(strangerToken),
    });
    expect(response.statusCode).toBe(404);
  });

  it('establishes a web session and rejects a cookie-authenticated mutation without a matching CSRF header', async () => {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/session',
      payload: { idToken: token },
    });
    expect(login.statusCode).toBe(204);

    const cookies = login.cookies;
    const sessionCookie = cookies.find((c) => c.name === '__session');
    const csrfCookie = cookies.find((c) => c.name === 'csrf_token');
    expect(sessionCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: {
        cookie: `__session=${sessionCookie?.value ?? ''}`,
        'idempotency-key': generateUuidV7(),
      },
      payload: { name: 'Cookie Garden' },
    });
    expect(created.statusCode).toBe(403);
    expect(asError(created).error.message).toContain('CSRF');
  });
});
