/**
 * Full HTTP-level tests for `PUT /gardens/{gardenId}/georeference`
 * (P12-GEO-01): the real Fastify application, real authentication, and a
 * real migrated PostgreSQL/PostGIS database — the same harness
 * `garden-context-routes.test.ts` uses.
 *
 * The endpoint that makes weather, hemisphere, and the seasonal plan
 * reachable at all: `gardens_mapping.georeference` has been read by those
 * three since Phase 3 and, until this work package, written by nothing but
 * test fixtures.
 *
 * Source: implementation-plan.md work package P12-GEO-01;
 * architecture/data-and-geospatial-design.md, section "9. Georeferencing".
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
  GardenMapDocument,
  Garden as GardenResource,
  Georeference,
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

const SUITE_NAME = 'garden georeference routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Somewhere in Iowa: a real place, in the product's first market. */
const DES_MOINES: readonly [number, number] = [-93.63, 41.59];

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

  function asGeoreference(response: InjectResponse): Georeference {
    return response.json<Georeference>();
  }

  function asError(response: InjectResponse): ApiError {
    return response.json<ApiError>();
  }

  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Georeferenced Garden' },
    });
    expect(response.statusCode).toBe(201);

    return { token, garden: response.json<GardenResource>() };
  }

  async function addEditorMembership(gardenId: string): Promise<string> {
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
        role: 'editor',
        state: 'active',
      })
      .execute();

    return token;
  }

  function setGeoreference(
    gardenId: string,
    token: string,
    payload: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<InjectResponse> {
    return app.inject({
      method: 'PUT',
      url: `/v1/gardens/${gardenId}/georeference`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        ...(expectedRevision === undefined ? {} : { 'if-match': `"${String(expectedRevision)}"` }),
      },
      payload,
    });
  }

  const VALID_BODY = {
    localAnchor: [0, 0],
    geographicAnchor: DES_MOINES,
    rotationDegrees: 12,
    method: 'mapPin',
  };

  it('creates the first record without If-Match and derives its provenance from the method', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await setGeoreference(garden.id, token, VALID_BODY);

    expect(response.statusCode).toBe(200);
    const georeference = asGeoreference(response);
    expect(georeference.revision).toBe(1);
    expect(georeference.geographicAnchor).toEqual(DES_MOINES);
    expect(georeference.rotationDegrees).toBe(12);
    // Never sent by the client: `mapPin` reads a basemap, which is what
    // `importedMapImagery` names.
    expect(georeference.provenance).toBe('importedMapImagery');
    expect(georeference.scaleCorrection).toBe(1);
  });

  // The write the web actually makes after an address search — and the one
  // this endpoint refused in production on 2026-08-04, because the transport
  // parser kept a hand-written method list that the contract had outgrown.
  it('accepts every method the contract defines, including addressSearch', async () => {
    for (const method of [
      'deviceLocation',
      'addressSearch',
      'mapPin',
      'manualCoordinates',
      'controlPoints',
      'imageryAlignment',
    ]) {
      const { token, garden } = await createGardenAsOwner();

      const response = await setGeoreference(garden.id, token, { ...VALID_BODY, method });

      expect(response.statusCode, `method ${method}`).toBe(200);
      expect(asGeoreference(response).method).toBe(method);
    }
  });

  it('appears on the garden map read, which is where every client finds it', async () => {
    const { token, garden } = await createGardenAsOwner();
    await setGeoreference(garden.id, token, VALID_BODY);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/map`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<GardenMapDocument>().georeference?.geographicAnchor).toEqual(DES_MOINES);
  });

  it('persists and returns the exact address candidate the owner accepted', async () => {
    const { token, garden } = await createGardenAsOwner();
    const formattedAddress = '100 GRAND AVE, DES MOINES, IA, 50309';

    const write = await setGeoreference(garden.id, token, {
      ...VALID_BODY,
      method: 'addressSearch',
      formattedAddress,
    });
    expect(write.statusCode).toBe(200);
    expect(asGeoreference(write).formattedAddress).toBe(formattedAddress);

    const read = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/map`,
      headers: bearer(token),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<GardenMapDocument>().georeference?.formattedAddress).toBe(formattedAddress);
  });

  it('supersedes rather than edits, leaving exactly one current record', async () => {
    const { token, garden } = await createGardenAsOwner();
    await setGeoreference(garden.id, token, VALID_BODY);

    const second = await setGeoreference(
      garden.id,
      token,
      { ...VALID_BODY, geographicAnchor: [-93.6, 41.6], method: 'manualCoordinates' },
      1,
    );

    expect(second.statusCode).toBe(200);
    expect(asGeoreference(second).revision).toBe(2);
    expect(asGeoreference(second).provenance).toBe('manualDrawing');

    const rows = await db
      .selectFrom('gardens_mapping.georeference')
      .select(['revision', 'valid_until'])
      .where('garden_id', '=', garden.id)
      .orderBy('revision')
      .execute();

    // The history is the point: an anchor moved by mistake stays visible.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.valid_until).not.toBeNull();
    expect(rows[1]?.valid_until).toBeNull();
  });

  it('refuses an omitted If-Match once a record exists, rather than overwriting it', async () => {
    const { token, garden } = await createGardenAsOwner();
    await setGeoreference(garden.id, token, VALID_BODY);

    const response = await setGeoreference(garden.id, token, VALID_BODY);

    expect(response.statusCode).toBe(412);
    expect(asError(response).error.code).toBe('garden.geometry.stale_revision');
  });

  it('refuses a stale If-Match and reports the revision that is current', async () => {
    const { token, garden } = await createGardenAsOwner();
    await setGeoreference(garden.id, token, VALID_BODY);
    await setGeoreference(garden.id, token, VALID_BODY, 1);

    const response = await setGeoreference(garden.id, token, VALID_BODY, 1);

    expect(response.statusCode).toBe(412);
    expect(asError(response).error.details?.[0]?.parameters?.['currentRevision']).toBe(2);
  });

  it('refuses an If-Match for a garden that has never been georeferenced', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await setGeoreference(garden.id, token, VALID_BODY, 1);

    expect(response.statusCode).toBe(412);
  });

  it('is owner-only: an editor may change garden content but not garden settings', async () => {
    const { garden } = await createGardenAsOwner();
    const editorToken = await addEditorMembership(garden.id);

    const response = await setGeoreference(garden.id, editorToken, VALID_BODY);

    expect(response.statusCode).toBe(403);
  });

  it('conceals a garden the caller has no membership on as 404', async () => {
    const { garden } = await createGardenAsOwner();
    const strangerToken = randomUUID();
    tokenVerifier.registerIdToken(strangerToken, randomUUID());

    const response = await setGeoreference(garden.id, strangerToken, VALID_BODY);

    expect(response.statusCode).toBe(404);
  });

  it('rejects a coordinate that is not on the Earth', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await setGeoreference(garden.id, token, {
      ...VALID_BODY,
      geographicAnchor: [-93.63, 91],
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a rotation of 360 rather than folding it to 0', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await setGeoreference(garden.id, token, {
      ...VALID_BODY,
      rotationDegrees: 360,
    });

    expect(response.statusCode).toBe(400);
  });

  it('replays an identical request under one idempotency key without a second revision', async () => {
    const { token, garden } = await createGardenAsOwner();
    const idempotencyKey = generateUuidV7();

    const first = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/georeference`,
      headers: { ...bearer(token), 'idempotency-key': idempotencyKey },
      payload: VALID_BODY,
    });
    const replay = await app.inject({
      method: 'PUT',
      url: `/v1/gardens/${garden.id}/georeference`,
      headers: { ...bearer(token), 'idempotency-key': idempotencyKey },
      payload: VALID_BODY,
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(asGeoreference(replay).revision).toBe(1);

    const rows = await db
      .selectFrom('gardens_mapping.georeference')
      .select('id')
      .where('garden_id', '=', garden.id)
      .execute();
    expect(rows).toHaveLength(1);
  });
});
