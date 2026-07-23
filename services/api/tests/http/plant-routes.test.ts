/**
 * Full HTTP-level contract tests for the plant routes: the real Fastify
 * application, the real authentication plugin, and a real migrated
 * PostgreSQL database — only the Firebase Admin SDK boundary is faked, since
 * a real Firebase project is not available in a test run. Mirrors
 * `garden-routes.test.ts`'s own structure and conventions exactly.
 *
 * Transport-layer coverage only (request parsing, status codes, response
 * shape) — the business logic each command implements is already covered by
 * `tests/integration/plants-inventory.test.ts` and
 * `tests/integration/plants-inventory-photos-identification.test.ts`.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Plants`;
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
import type { ApiError, Garden as GardenResource, Plant } from '@verdery/api-contracts';
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

function asPlant(response: InjectResponse): Plant {
  return response.json<Plant>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'plant routes (HTTP)';
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
      payload: { name: 'Plant Test Garden' },
    });

    return { token, garden: asGarden(created) };
  }

  it('rejects adding a plant missing the Idempotency-Key header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants`,
      headers: bearer(token),
      payload: { displayName: 'Tomato', groupingKind: 'individual' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects updating plant details with a missing If-Match header with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const created = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Basil', groupingKind: 'individual' },
    });
    const plant = asPlant(created);

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}/plants/${plant.id}`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Sweet Basil' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('conceals a plant that does not exist in an owned garden as 404', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plants/${generateUuidV7()}`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('plants_inventory.plant.not_found');
  });

  it('conceals a plant that exists but belongs to a different garden as the identical 404, never distinguishing the two', async () => {
    const { garden: otherGarden, token: otherToken } = await createGardenAsOwner();
    const added = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${otherGarden.id}/plants`,
      headers: { ...bearer(otherToken), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Basil', groupingKind: 'individual' },
    });
    const foreignPlant = asPlant(added);

    const { token, garden } = await createGardenAsOwner();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plants/${foreignPlant.id}`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('plants_inventory.plant.not_found');
  });

  it('runs the full lifecycle over real HTTP: add, get, update details, transition lifecycle stage', async () => {
    const { token, garden } = await createGardenAsOwner();

    const added = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: {
        displayName: 'Cherry Tomato',
        groupingKind: 'individual',
        acquisitionDateType: 'sown',
      },
    });
    expect(added.statusCode).toBe(201);
    const plant = asPlant(added);
    expect(plant).toMatchObject({
      gardenId: garden.id,
      displayName: 'Cherry Tomato',
      groupingKind: 'individual',
      lifecycleStage: 'planned',
      status: 'active',
      revision: 1,
    });

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plants/${plant.id}`,
      headers: bearer(token),
    });
    expect(fetched.statusCode).toBe(200);
    expect(asPlant(fetched).id).toBe(plant.id);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/gardens/${garden.id}/plants/${plant.id}`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(plant.revision)}"`,
      },
      payload: { varietyLabel: 'Sungold', conditionNote: 'Thriving' },
    });
    expect(updated.statusCode).toBe(200);
    const updatedPlant = asPlant(updated);
    expect(updatedPlant).toMatchObject({
      varietyLabel: 'Sungold',
      conditionNote: 'Thriving',
      revision: plant.revision + 1,
    });

    const transitioned = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants/${plant.id}/lifecycle-stage`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': `"${String(updatedPlant.revision)}"`,
      },
      payload: { stage: 'seedling' },
    });
    expect(transitioned.statusCode).toBe(200);
    expect(asPlant(transitioned)).toMatchObject({
      lifecycleStage: 'seedling',
      revision: updatedPlant.revision + 1,
    });
  });
});
