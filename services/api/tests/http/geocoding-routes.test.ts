/**
 * HTTP-level tests for `GET /v1/geocoding/address-candidates` (P12-GEO-01).
 *
 * The real Fastify application and the real plugin chain, with one
 * substitution: the geocoder itself, so no test reaches census.gov.
 *
 * The route reads no garden and touches no table, but it sits inside the
 * authenticated context, and authenticating provisions a profile — which is a
 * real write. So this suite carries the same container harness as its
 * siblings rather than pretending the route is databaseless.
 *
 * Source: packages/api-contracts/openapi.yaml, operation
 * `findAddressCandidates`.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressCandidateListResult, ApiError } from '@verdery/api-contracts';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type { AddressGeocodingAdapter } from '../../src/modules/integrations/public.js';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import '../../src/platform/database/pg-bigint-parser.js';

const SUITE_NAME = 'geocoding routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const CANDIDATE = {
  formattedAddress: '100 GRAND AVE, DES MOINES, IA, 50309',
  position: [-93.63, 41.59] as [number, number],
  precision: 'streetAddress' as const,
};

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

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let db: Kysely<DatabaseSchema>;
  let app: FastifyInstance;
  let tokenVerifier: FakeTokenVerifier;
  let token: string;
  let geocoder: AddressGeocodingAdapter & {
    behaviour: (query: string) => Promise<readonly (typeof CANDIDATE)[]>;
  };

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

    const pool = new pg.Pool({ connectionString: databaseUrl });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
    const database: DatabaseGateway = {
      queries: db,
      ping: () => Promise.resolve(),
      close: () => db.destroy(),
    };

    tokenVerifier = new FakeTokenVerifier();
    token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    geocoder = {
      behaviour: () => Promise.resolve([CANDIDATE]),
      findAddressCandidates: (query) => geocoder.behaviour(query),
    };

    app = await buildTestApplication({ database, tokenVerifier, addressGeocoder: geocoder });
  });

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  function search(query: string, authenticated = true) {
    return app.inject({
      method: 'GET',
      url: `/v1/geocoding/address-candidates?query=${encodeURIComponent(query)}`,
      ...(authenticated ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });
  }

  it('refuses an unauthenticated caller — this spends a provider call', async () => {
    const response = await search('100 Grand Ave', false);

    expect(response.statusCode).toBe(401);
    expect(response.json<ApiError>().error.code).toBe('auth.unauthenticated');
  });

  it('returns candidates with the provider marked available', async () => {
    geocoder.behaviour = () => Promise.resolve([CANDIDATE]);

    const response = await search('100 Grand Ave');

    expect(response.statusCode).toBe(200);
    expect(response.json<AddressCandidateListResult>()).toEqual({
      items: [
        {
          formattedAddress: '100 GRAND AVE, DES MOINES, IA, 50309',
          position: [-93.63, 41.59],
          precision: 'streetAddress',
        },
      ],
      providerAvailable: true,
    });
  });

  // The two answers the response shape exists to keep apart.
  it('reports no matches with the provider still available', async () => {
    geocoder.behaviour = () => Promise.resolve([]);

    const body = (await search('nowhere at all')).json<AddressCandidateListResult>();

    expect(body).toEqual({ items: [], providerAvailable: true });
  });

  it('reports a provider failure as unavailable rather than as an error response', async () => {
    geocoder.behaviour = () => Promise.reject(new Error('provider down'));

    const response = await search('100 Grand Ave');

    expect(response.statusCode).toBe(200);
    expect(response.json<AddressCandidateListResult>()).toEqual({
      items: [],
      providerAvailable: false,
    });
  });

  it('rejects a query too short to be an address', async () => {
    const response = await search('ab');

    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing query', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/geocoding/address-candidates',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(400);
  });
});
