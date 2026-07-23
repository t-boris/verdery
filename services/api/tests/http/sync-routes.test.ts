/**
 * HTTP-level contract tests for the synchronization routes: the real
 * Fastify application, the real authentication plugin, and a real migrated
 * PostgreSQL database — only the Firebase Admin SDK boundary is faked, the
 * same convention `task-routes.test.ts`'s own header comment describes.
 *
 * Transport-layer coverage only (request parsing, status codes, response
 * shape) — the business logic each command implements is already covered by
 * `tests/integration/synchronization.test.ts`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Synchronization`.
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
  Garden as GardenResource,
  SyncClientInstallation,
  SyncPushResult,
} from '@verdery/api-contracts';
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

function asInstallation(response: InjectResponse): SyncClientInstallation {
  return response.json<SyncClientInstallation>();
}

function asPushResult(response: InjectResponse): SyncPushResult {
  return response.json<SyncPushResult>();
}

const SUITE_NAME = 'sync routes (HTTP)';
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
      payload: { name: 'Sync Test Garden' },
    });

    return { token, garden: asGarden(created) };
  }

  describe('PUT /v1/sync/clients/{clientInstallationId}', () => {
    it('rejects registration missing the Idempotency-Key header with 400', async () => {
      const token = randomUUID();
      tokenVerifier.registerIdToken(token, randomUUID());

      const response = await app.inject({
        method: 'PUT',
        url: `/v1/sync/clients/${generateUuidV7()}`,
        headers: bearer(token),
        payload: { platform: 'ios', appVersion: '1.0.0', protocolVersion: 1 },
      });

      expect(response.statusCode).toBe(400);
    });

    it('registers a new installation as 201, then refreshes it as 200', async () => {
      const token = randomUUID();
      tokenVerifier.registerIdToken(token, randomUUID());
      const clientInstallationId = generateUuidV7();

      const created = await app.inject({
        method: 'PUT',
        url: `/v1/sync/clients/${clientInstallationId}`,
        headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
        payload: { platform: 'ios', appVersion: '1.0.0', protocolVersion: 1 },
      });
      expect(created.statusCode).toBe(201);
      expect(asInstallation(created)).toMatchObject({ id: clientInstallationId, platform: 'ios' });

      const refreshed = await app.inject({
        method: 'PUT',
        url: `/v1/sync/clients/${clientInstallationId}`,
        headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
        payload: { platform: 'ios', appVersion: '1.1.0', protocolVersion: 1 },
      });
      expect(refreshed.statusCode).toBe(200);
      expect(asInstallation(refreshed)).toMatchObject({ appVersion: '1.1.0' });
    });

    // No HTTP-level test for the `409 sync.protocol_version.unsupported`
    // response: `protocolVersion` carries `minimum: 1` on the wire (the
    // same floor `MIN_SUPPORTED_SYNC_PROTOCOL_VERSION` currently uses, this
    // being the sync protocol's first shipped version — see
    // `sync-protocol-version.ts`'s own doc comment), so no structurally
    // valid request can reach this response through real request parsing
    // today. `application/sync-protocol-version.test.ts` proves the guard
    // itself throws the right error directly, ahead of the day the server
    // raises its minimum and this path becomes reachable over HTTP too.
  });

  describe('POST /v1/sync/push', () => {
    it('rejects a malformed batch (empty operations) with 400', async () => {
      const { token } = await createGardenAsOwner();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: bearer(token),
        payload: {
          clientInstallationId: generateUuidV7(),
          protocolVersion: 1,
          operationPayloadVersion: 1,
          operations: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts a garden rename operation and returns 200 with an accepted result', async () => {
      const { token, garden } = await createGardenAsOwner();
      const operationId = generateUuidV7();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: bearer(token),
        payload: {
          clientInstallationId: generateUuidV7(),
          protocolVersion: 1,
          operationPayloadVersion: 1,
          operations: [
            {
              operationId,
              localSequence: 0,
              dependsOnOperationIds: [],
              mediaPrerequisites: [],
              payload: {
                recordType: 'garden',
                gardenId: garden.id,
                command: {
                  commandType: 'gardens.rename',
                  expectedRevision: garden.revision,
                  request: { name: 'Renamed via sync' },
                },
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = asPushResult(response);
      expect(body.results).toEqual([
        {
          outcome: 'accepted',
          operationId,
          recordRevisions: [
            { recordType: 'garden', recordId: garden.id, revision: garden.revision + 1 },
          ],
        },
      ]);
    });

    it('never fails the whole batch for a per-operation domain problem — always 200', async () => {
      const { token, garden } = await createGardenAsOwner();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: bearer(token),
        payload: {
          clientInstallationId: generateUuidV7(),
          protocolVersion: 1,
          operationPayloadVersion: 1,
          operations: [
            {
              operationId: generateUuidV7(),
              localSequence: 0,
              dependsOnOperationIds: [],
              mediaPrerequisites: [],
              payload: {
                recordType: 'garden',
                gardenId: garden.id,
                command: {
                  commandType: 'gardens.rename',
                  expectedRevision: garden.revision + 99,
                  request: { name: 'Never applied' },
                },
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(asPushResult(response).results[0]).toMatchObject({ outcome: 'conflict' });
    });
  });

  describe('POST /v1/sync/acknowledge', () => {
    it('reports unknown for an operation id that was never pushed', async () => {
      const { token } = await createGardenAsOwner();
      const neverPushedOperationId = generateUuidV7();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/sync/acknowledge',
        headers: bearer(token),
        payload: {
          clientInstallationId: generateUuidV7(),
          operationIds: [neverPushedOperationId],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        results: [{ outcome: 'unknown', operationId: neverPushedOperationId }],
      });
    });
  });
});
