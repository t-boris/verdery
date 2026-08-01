/**
 * Full HTTP-level contract tests for the horticultural-review routes
 * (P11-PROV-01): the real Fastify application, the real authentication
 * plugin, and a real migrated PostgreSQL database — only the Firebase Admin
 * SDK boundary is faked, since a real Firebase project is not available in a
 * test run. Mirrors `task-routes.test.ts`'s own structure and conventions.
 *
 * Transport-layer coverage plus the authorization gate itself (there is no
 * separate authorization-repository layer to unit-test independently — see
 * `plant-reviewer-authorization.ts`'s own header): unauthenticated, an
 * authenticated non-reviewer, and an authenticated reviewer over the real
 * route. The command-level behavior (aggregation, name resolution,
 * review-status transition) is already covered by `list-plant-assertions-
 * awaiting-review.test.ts` and `approve-plant-assertion-review.test.ts`.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication, testConfiguration } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type { ApiError } from '@verdery/api-contracts';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'plant assertion review routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const REVIEWER_UID = 'reviewer-uid';
const REVIEWER_EMAIL = `${REVIEWER_UID}@example.com`;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents — the `task-routes.test.ts` precedent. */
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
    app = await buildTestApplication({
      database,
      tokenVerifier,
      configuration: {
        ...testConfiguration,
        plantReview: { reviewerEmails: [REVIEWER_EMAIL] },
      },
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

  function reviewerToken(): string {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, REVIEWER_UID);
    return token;
  }

  function nonReviewerToken(): string {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, `not-a-reviewer-${randomUUID()}`);
    return token;
  }

  async function insertPendingFactAssertion(): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('integrations.plant_fact_assertion')
      .values({
        id,
        provider_key: 'gbif',
        provider_taxon_id: `gbif-${randomUUID()}`,
        fact_key: 'occurrence_evidence_count',
        fact_value: JSON.stringify('51258'),
        unit: 'records',
        confidence: null,
        geographic_scope: null,
        authoring_method: 'ai_extracted_from_source',
        source_citation: 'GBIF.org',
        review_status: 'awaiting_horticultural_review',
        reviewed_by: null,
        reviewed_on: null,
        fetched_at: new Date(),
      })
      .execute();
    return id;
  }

  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/plant-assertion-reviews' });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an authenticated non-reviewer with 403', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/plant-assertion-reviews',
      headers: bearer(nonReviewerToken()),
    });

    expect(response.statusCode).toBe(403);
    expect(asError(response).error.code).toBe('auth.forbidden');
  });

  it('lists a pending fact assertion for an authorized reviewer, and approves it', async () => {
    const assertionId = await insertPendingFactAssertion();
    const token = reviewerToken();

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/plant-assertion-reviews',
      headers: bearer(token),
    });
    expect(listed.statusCode).toBe(200);
    const { pending } = listed.json<{
      pending: { kind: string; assertion: { id: string } }[];
    }>();
    expect(pending.some((item) => item.kind === 'fact' && item.assertion.id === assertionId)).toBe(
      true,
    );

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/plant-assertion-reviews/fact/${assertionId}/approve`,
      headers: bearer(token),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<{ outcome: string }>()).toEqual({ outcome: 'approved' });

    const row = await db
      .selectFrom('integrations.plant_fact_assertion')
      .selectAll()
      .where('id', '=', assertionId)
      .executeTakeFirstOrThrow();
    expect(row.review_status).toBe('horticulturally_reviewed');
    expect(row.reviewed_by).toBe(REVIEWER_EMAIL);

    const listedAfter = await app.inject({
      method: 'GET',
      url: '/v1/plant-assertion-reviews',
      headers: bearer(token),
    });
    const { pending: pendingAfter } = listedAfter.json<{
      pending: { assertion: { id: string } }[];
    }>();
    expect(pendingAfter.some((item) => item.assertion.id === assertionId)).toBe(false);
  });

  it('answers alreadyReviewedOrMissing when approving the same assertion twice', async () => {
    const assertionId = await insertPendingFactAssertion();
    const token = reviewerToken();

    const first = await app.inject({
      method: 'POST',
      url: `/v1/plant-assertion-reviews/fact/${assertionId}/approve`,
      headers: bearer(token),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/plant-assertion-reviews/fact/${assertionId}/approve`,
      headers: bearer(token),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ outcome: string }>()).toEqual({ outcome: 'alreadyReviewedOrMissing' });
  });

  it('rejects an invalid kind path parameter with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/plant-assertion-reviews/not-a-kind/${generateUuidV7()}/approve`,
      headers: bearer(reviewerToken()),
    });

    expect(response.statusCode).toBe(400);
  });
});
