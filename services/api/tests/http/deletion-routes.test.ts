/**
 * Full HTTP-level contract tests for the P8-DELETE-01 surfaces: the
 * `Account` tag (`POST`/`GET`/`DELETE /account/deletion`), the garden
 * restore verb (`DELETE /gardens/{gardenId}/delete-request`), and the
 * internal OIDC-verified deletion sweep — the real Fastify application, the
 * real authentication plugin with its real account-state gate, and a real
 * migrated PostgreSQL database.
 *
 * The property only HTTP can prove, and the one this suite exists for: an
 * account inside its recovery window is refused by every ordinary endpoint
 * (`403`, because `isAccountUsable` is false) yet can still read and
 * withdraw its own deletion. A recovery window that locked the user out of
 * recovering would satisfy every unit test and none of the requirement.
 *
 * Source: packages/api-contracts/openapi.yaml, tags `Account` and `Gardens`;
 * implementation-plan.md work package P8-DELETE-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountDeletion, Garden as GardenResource } from '@verdery/api-contracts';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import { UnauthenticatedError } from '../../src/platform/errors/application-error.js';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from '../../src/platform/tasks/cloud-tasks-invocation-verifier.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';

const SUITE_NAME = 'deletion routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const WORKER_TOKEN = 'Bearer worker-test-token';

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token to the credential it represents, including how long ago the sign-in was. */
class FakeTokenVerifier implements TokenVerifier {
  private readonly credentialsByToken = new Map<string, VerifiedCredential>();

  registerIdToken(token: string, firebaseUid: string, authenticatedAt = new Date()): void {
    this.credentialsByToken.set(token, {
      firebaseUid,
      signInProvider: 'google.com',
      providerUid: firebaseUid,
      authenticatedAt,
      email: `${firebaseUid}@example.com`,
      emailVerified: true,
    });
  }

  verifyIdToken(idToken: string): Promise<VerifiedCredential> {
    const credential = this.credentialsByToken.get(idToken);
    return credential === undefined
      ? Promise.reject(new Error('unknown test token'))
      : Promise.resolve(credential);
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

const workerVerifier: CloudTasksInvocationVerifier = {
  verify: (header) =>
    header === WORKER_TOKEN
      ? Promise.resolve()
      : Promise.reject(new UnauthenticatedError('auth.unauthenticated', 'Not the worker.')),
};

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let db: Kysely<DatabaseSchema>;
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

    db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl }) }),
    });
    const database: DatabaseGateway = {
      queries: db,
      ping: () => Promise.resolve(),
      close: () => db.destroy(),
    };

    tokenVerifier = new FakeTokenVerifier();
    app = await buildTestApplication({
      database,
      tokenVerifier,
      cloudTasksInvocationVerifier: workerVerifier,
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

  async function signedInUser(authenticatedAt = new Date()): Promise<string> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID(), authenticatedAt);
    return Promise.resolve(token);
  }

  async function createGarden(token: string): Promise<GardenResource> {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'HTTP Deletion Garden' },
    });
    return created.json<GardenResource>();
  }

  it('rejects unauthenticated deletion requests with 401 and an unauthenticated sweep trigger with 401', async () => {
    for (const method of ['POST', 'GET', 'DELETE'] as const) {
      const response = await app.inject({ method, url: '/v1/account/deletion' });
      expect(response.statusCode).toBe(401);
    }

    const sweep = await app.inject({ method: 'POST', url: '/v1/internal/deletion/sweep' });
    expect(sweep.statusCode).toBe(401);
  });

  it('runs the sweep for the worker identity and reports typed counters', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/deletion/sweep',
      headers: { authorization: WORKER_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      gardensClaimed: 0,
      accountsClaimed: 0,
      purgesCompleted: 0,
      purgesDeferred: 0,
      purgesFailed: 0,
      lostClaims: 0,
    });
  });

  it('rejects a deletion request, and a garden restore, from a session whose sign-in is stale', async () => {
    const staleToken = await signedInUser(new Date(Date.now() - 6 * 60 * 60 * 1000));

    const account = await app.inject({
      method: 'POST',
      url: '/v1/account/deletion',
      headers: { ...bearer(staleToken), 'idempotency-key': generateUuidV7() },
    });
    expect(account.statusCode).toBe(403);
    expect(account.json()).toMatchObject({
      error: { code: 'deletion.recent_authentication_required' },
    });
  });

  it('returns 404 when no deletion is pending', async () => {
    const token = await signedInUser();
    await createGarden(token);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/account/deletion',
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'deletion.not_found' } });
  });

  it('keeps the account-deletion resource reachable inside the recovery window while every other endpoint refuses the same session', async () => {
    const token = await signedInUser();
    const garden = await createGarden(token);

    const requested = await app.inject({
      method: 'POST',
      url: '/v1/account/deletion',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
    });
    expect(requested.statusCode).toBe(200);
    const deletion = requested.json<AccountDeletion>();
    expect(deletion.state).toBe('recoveryWindow');
    expect(deletion.gardens).toEqual([
      { gardenId: garden.id, resolution: 'gardenDeletionRequested' },
    ]);

    // Ordinary endpoints now refuse this account outright.
    const gardens = await app.inject({ method: 'GET', url: '/v1/gardens', headers: bearer(token) });
    expect(gardens.statusCode).toBe(403);

    // The deletion resource does not.
    const status = await app.inject({
      method: 'GET',
      url: '/v1/account/deletion',
      headers: bearer(token),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<AccountDeletion>()).toEqual(deletion);

    // And withdrawing works, which is the entire point of the window.
    const withdrawn = await app.inject({
      method: 'DELETE',
      url: '/v1/account/deletion',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
    });
    expect(withdrawn.statusCode).toBe(204);

    const afterRestore = await app.inject({
      method: 'GET',
      url: '/v1/gardens',
      headers: bearer(token),
    });
    expect(afterRestore.statusCode).toBe(200);
  });

  it('requests and withdraws a garden deletion over HTTP, reporting the recovery deadline on the resource', async () => {
    const token = await signedInUser();
    const garden = await createGarden(token);

    const requested = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/delete-request`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': String(garden.revision),
      },
    });
    expect(requested.statusCode).toBe(200);
    const pending = requested.json<GardenResource>();
    expect(pending.lifecycleState).toBe('deletionRequested');
    expect(typeof pending.recoveryDeadlineAt).toBe('string');

    const restored = await app.inject({
      method: 'DELETE',
      url: `/v1/gardens/${garden.id}/delete-request`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': String(pending.revision),
      },
    });
    expect(restored.statusCode).toBe(200);
    const active = restored.json<GardenResource>();
    expect(active.lifecycleState).toBe('active');
    expect(active.recoveryDeadlineAt).toBeUndefined();
  });
});
