/**
 * Full HTTP-level contract tests for the task routes: the real Fastify
 * application, the real authentication plugin, and a real migrated
 * PostgreSQL database — only the Firebase Admin SDK boundary is faked, since
 * a real Firebase project is not available in a test run. Mirrors
 * `garden-routes.test.ts`'s own structure and conventions exactly.
 *
 * Transport-layer coverage only (request parsing, status codes, response
 * shape) — the business logic each command implements is already covered by
 * `tests/integration/tasks-recommendations.test.ts`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Tasks`;
 * implementation-plan.md work package P4-CONTRACT-01.
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
import type { ApiError, Garden as GardenResource, Task } from '@verdery/api-contracts';
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

function asTask(response: InjectResponse): Task {
  return response.json<Task>();
}

function asItems<T>(response: InjectResponse): { items: T[] } {
  return response.json<{ items: T[] }>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'task routes (HTTP)';
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

  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Task Test Garden' },
    });

    return { token, garden: asGarden(created) };
  }

  it('rejects creating a task missing the Idempotency-Key header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/tasks`,
      headers: bearer(token),
      payload: { target: { kind: 'garden' }, title: 'Water the beds' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects editing a task with a missing If-Match header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const created = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/tasks`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { target: { kind: 'garden' }, title: 'Prune roses' },
    });
    const task = asTask(created);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}/tasks/${task.id}`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { title: 'Prune roses thoroughly' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('reports rescheduling a task that does not exist as 404', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/tasks/${generateUuidV7()}/reschedule`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': '"1"',
      },
      payload: { dueDate: '2026-08-01' },
    });

    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('tasks_recommendations.task.not_found');
  });

  it('runs the full lifecycle over real HTTP: create, list, edit, complete', async () => {
    const { token, garden } = await createGardenAsOwner();

    const created = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/tasks`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: {
        target: { kind: 'garden' },
        title: 'Weed the beds',
        urgency: 'high',
      },
    });
    expect(created.statusCode).toBe(201);
    const task = asTask(created);
    expect(task).toMatchObject({
      gardenId: garden.id,
      targetKind: 'garden',
      title: 'Weed the beds',
      status: 'planned',
      urgency: 'high',
      source: 'manual',
      revision: 1,
    });

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/tasks?status=planned`,
      headers: bearer(token),
    });
    expect(listed.statusCode).toBe(200);
    const { items } = asItems<Task>(listed);
    expect(items.map((item) => item.id)).toContain(task.id);

    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}/tasks/${task.id}`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(task.revision)}"`,
      },
      payload: { title: 'Weed and mulch the beds' },
    });
    expect(edited.statusCode).toBe(200);
    const editedTask = asTask(edited);
    expect(editedTask).toMatchObject({
      title: 'Weed and mulch the beds',
      revision: task.revision + 1,
    });

    const completed = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/tasks/${task.id}/complete`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(editedTask.revision)}"`,
      },
      payload: {},
    });
    expect(completed.statusCode).toBe(200);
    const completedTask = asTask(completed);
    expect(completedTask.status).toBe('completed');
    expect(completedTask.completedAt).not.toBeNull();
  });
});
