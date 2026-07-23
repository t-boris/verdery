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
  let logRecords: string[];

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
    logRecords = [];
    app = await buildTestApplication({
      database,
      tokenVerifier,
      onLogRecord: (record) => logRecords.push(record),
    });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  /** The most recently logged record whose `event` field matches — parsed, not a raw string search. */
  function lastLogEvent(event: string): Record<string, unknown> | undefined {
    const matches = logRecords
      .map((record) => JSON.parse(record) as Record<string, unknown>)
      .filter((parsed) => parsed['event'] === event);
    return matches.at(-1);
  }

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

    // No HTTP-level test for the `409 sync.protocol_version.unsupported`
    // response here either, for the identical reason the client-registration
    // `describe` block above documents: `protocolVersion` carries
    // `minimum: 1` on the wire, so no structurally valid request can reach
    // it today. `tests/integration/synchronization.test.ts` proves
    // `PushSyncOperations.execute` itself raises the right error, calling it
    // directly and bypassing request parsing, the same way that file's
    // pull-side equivalent already does for `GetSyncChanges`.

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

      // P5-OBS-01: one aggregate-count log line per batch, no operation
      // payloads — see sync-routes.ts's own header comment.
      const logged = lastLogEvent('sync.push.completed');
      expect(logged).toMatchObject({
        protocolVersion: 1,
        operationCount: 1,
        accepted: 1,
        duplicate: 0,
        rejected: 0,
        conflict: 0,
        blockedByDependency: 0,
        retryLater: 0,
      });
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

      expect(lastLogEvent('sync.push.completed')).toMatchObject({
        accepted: 0,
        conflict: 1,
      });
    });
  });

  describe('GET /v1/sync/changes', () => {
    it('rejects a request missing protocolVersion with 400', async () => {
      const { token } = await createGardenAsOwner();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/sync/changes',
        headers: bearer(token),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns the garden creation change on a first pull, with nextCursor present', async () => {
      const { token, garden } = await createGardenAsOwner();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/sync/changes?protocolVersion=1',
        headers: bearer(token),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<{
        items: readonly { recordType: string; operation: string; recordId: string }[];
        nextCursor: string;
      }>();
      expect(body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recordType: 'garden',
            operation: 'upsert',
            recordId: garden.id,
          }),
        ]),
      );
      expect(typeof body.nextCursor).toBe('string');

      // P5-OBS-01: page size and lag, no record content — see sync-routes.ts's
      // own header comment. `pullLagMilliseconds` is present (the page is not
      // empty) and non-negative — the exact value depends on real wall-clock
      // timing between the write and this read, so only its shape is checked.
      const logged = lastLogEvent('sync.pull.completed');
      expect(logged).toMatchObject({ protocolVersion: 1, cursorPresent: false });
      expect(logged?.['pageSize']).toBeGreaterThanOrEqual(1);
      expect(logged?.['pullLagMilliseconds']).toBeGreaterThanOrEqual(0);
    });

    it('logs sync.pull.rejected, not sync.pull.completed, when the cursor cannot be decoded', async () => {
      const { token } = await createGardenAsOwner();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/sync/changes?protocolVersion=1&after=not-a-valid-cursor',
        headers: bearer(token),
      });

      // Same `SharedErrorCode.RequestInvalid` (`request.invalid`, with a
      // `request.cursor.invalid` detail pointer at `/after`) `ValidationError`
      // `decodeSyncChangesCursor` raises for any malformed `after` — not the
      // two stable full-resync `409` codes (`sync.changes.cursor_expired`/
      // `sync.protocol_version.unsupported`), which this suite's own earlier
      // comment already establishes are unreachable through real HTTP request
      // parsing today and are instead proven directly by
      // `tests/integration/synchronization-pull.test.ts`. This still proves
      // the same `sync.pull.rejected` logging path fires on a real
      // `ApplicationError` thrown from `GetSyncChanges.execute()`.
      expect(response.statusCode).toBe(400);

      const rejected = lastLogEvent('sync.pull.rejected');
      expect(rejected).toMatchObject({
        protocolVersion: 1,
        cursorPresent: true,
        errorCode: 'request.invalid',
      });
    });

    it('rejects protocolVersion 0 with 400 before it ever reaches the protocol-window guard', async () => {
      const { token } = await createGardenAsOwner();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/sync/changes?protocolVersion=0',
        headers: bearer(token),
      });

      // `protocolVersion` carries `minimum: 1` on the wire, so `0` fails this
      // route's own request-level validation before `GetSyncChanges`'s own
      // `409 sync.protocol_version.unsupported` guard ever runs — the same
      // "not reachable through real HTTP parsing today" situation
      // `sync-protocol-version.test.ts`'s own comment documents for the other
      // two sync routes. That guard's own `409` behavior is instead proven
      // directly, bypassing HTTP parsing, by
      // `tests/integration/synchronization-pull.test.ts`.
      expect(response.statusCode).toBe(400);
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
