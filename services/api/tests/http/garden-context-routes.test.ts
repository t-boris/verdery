/**
 * Full HTTP-level contract tests for the garden context fact routes
 * (P9D-CONTEXT-01): `GET /gardens/{gardenId}/context` and
 * `PUT /gardens/{gardenId}/context/{contextKind}` — the real Fastify
 * application, real authentication, and a real migrated PostgreSQL
 * database, matching `garden-routes.test.ts`'s own harness.
 *
 * Source: implementation-plan.md §18.2, work package P9D-CONTEXT-01
 * ("Context provenance tests").
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type {
  ApiError,
  Garden as GardenResource,
  GardenContextFact as GardenContextFactResource,
  GardenContextFactListResult,
} from '@verdery/api-contracts';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';
// `reviewed_on` is a `date` column — see `pg-date-parser.ts`'s own header
// comment for why this side-effect import is required.
import '../../src/platform/database/pg-date-parser.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function asGarden(response: InjectResponse): GardenResource {
  return response.json<GardenResource>();
}

function asFact(response: InjectResponse): GardenContextFactResource {
  return response.json<GardenContextFactResource>();
}

function asFactList(response: InjectResponse): GardenContextFactListResult {
  return response.json<GardenContextFactListResult>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'garden context routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents — the same fake `garden-routes.test.ts` already uses. */
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

  /** Creates a garden over real HTTP as its owner, returning the owner's bearer token alongside the created garden. */
  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Context Garden' },
    });
    expect(response.statusCode).toBe(201);

    return { token, garden: asGarden(response) };
  }

  /** Grants a fresh profile `viewer` membership on `gardenId` directly via SQL — the same shortcut this codebase's own map-object HTTP tests use to reach a non-owner role without the full invitation flow. */
  async function addViewerMembership(gardenId: string): Promise<string> {
    const token = randomUUID();
    const profileId = randomUUID();
    tokenVerifier.registerIdToken(token, profileId);

    await db
      .insertInto('identity_access.profile')
      .values({ id: profileId, firebase_uid: profileId, account_state: 'active' })
      .execute();
    await db
      .insertInto('collaboration.membership')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        profile_id: profileId,
        role: 'viewer',
        state: 'active',
      })
      .execute();

    return token;
  }

  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/gardens/does-not-matter/context',
    });
    expect(response.statusCode).toBe(401);
    expect(asError(response).error.code).toBe('auth.unauthenticated');
  });

  it('conceals a garden the caller has no membership on as 404 for both routes', async () => {
    const { garden } = await createGardenAsOwner();
    const strangerToken = randomUUID();
    tokenVerifier.registerIdToken(strangerToken, randomUUID());

    const listResponse = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/context`,
      headers: bearer(strangerToken),
    });
    expect(listResponse.statusCode).toBe(404);

    const putResponse = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/sun_exposure`,
      headers: bearer(strangerToken),
      payload: { value: 'full_sun', source: 'user_declared' },
    });
    expect(putResponse.statusCode).toBe(404);
  });

  it('rejects an unrecognized contextKind path segment with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/wind_speed`,
      headers: bearer(token),
      payload: { value: 'high', source: 'user_declared' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a value outside its contextKind vocabulary with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/drainage`,
      headers: bearer(token),
      payload: { value: 'soggy', source: 'user_declared' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects horticulturally_reviewed_default missing reviewedBy/reviewedOn with 400', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/soil_type`,
      headers: bearer(token),
      payload: { value: 'Sandy loam', source: 'horticulturally_reviewed_default' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('records, returns, and lists a context fact over real HTTP, without requiring Idempotency-Key or If-Match', async () => {
    const { token, garden } = await createGardenAsOwner();

    const recorded = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/sun_exposure`,
      headers: bearer(token),
      payload: { value: 'full_sun', source: 'user_declared' },
    });
    expect(recorded.statusCode).toBe(200);
    const fact = asFact(recorded);
    expect(fact).toMatchObject({
      gardenId: garden.id,
      contextKind: 'sun_exposure',
      value: 'full_sun',
      source: 'user_declared',
      revision: 1,
    });
    expect(fact.reviewedBy).toBeUndefined();

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/context`,
      headers: bearer(token),
    });
    expect(listed.statusCode).toBe(200);
    expect(asFactList(listed).items).toEqual([fact]);
  });

  it('updates the same fact in place on a second PUT for the same contextKind — no second row', async () => {
    const { token, garden } = await createGardenAsOwner();

    await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/irrigation_method`,
      headers: bearer(token),
      payload: { value: 'manual', source: 'user_declared' },
    });

    const second = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/irrigation_method`,
      headers: bearer(token),
      payload: {
        value: 'drip',
        source: 'horticulturally_reviewed_default',
        reviewedBy: 'Dr. Amara Osei',
        reviewedOn: '2026-03-15',
      },
    });
    expect(second.statusCode).toBe(200);
    expect(asFact(second)).toMatchObject({ value: 'drip', revision: 2 });

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/context`,
      headers: bearer(token),
    });
    expect(asFactList(listed).items).toHaveLength(1);
  });

  it('lets a viewer-only member list facts but refuses them recording one, with 403', async () => {
    const { token: ownerToken, garden } = await createGardenAsOwner();
    await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/growing_context`,
      headers: bearer(ownerToken),
      payload: { value: 'container', source: 'user_declared' },
    });

    const viewerToken = await addViewerMembership(garden.id);

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/context`,
      headers: bearer(viewerToken),
    });
    expect(listed.statusCode).toBe(200);
    expect(asFactList(listed).items).toHaveLength(1);

    const denied = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/context/growing_context`,
      headers: bearer(viewerToken),
      payload: { value: 'greenhouse', source: 'user_declared' },
    });
    expect(denied.statusCode).toBe(403);
    expect(asError(denied).error.code).toBe('auth.forbidden');
  });
});
