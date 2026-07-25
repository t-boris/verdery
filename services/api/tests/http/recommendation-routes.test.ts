/**
 * Full HTTP-level contract tests for the Today and recommendation routes
 * (P7-BE-01): the real Fastify application, the real authentication
 * plugin, and a real migrated PostgreSQL database — mirrors
 * `task-routes.test.ts`'s structure and conventions exactly.
 *
 * Transport-layer coverage only (request parsing, status codes, response
 * shape, header requirements); the business logic is covered by the
 * module's unit tests and `tests/integration/recommendation-today-outcomes.test.ts`.
 * Candidates are seeded directly in SQL because no client-facing endpoint
 * creates them — generation is the server-side engine's alone, which is
 * itself the contract being honored.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Recommendations`;
 * implementation-plan.md work package P7-BE-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication } from '../support/application.js';
import { emittedPayloadKeys, lastLogEvent } from '../support/log-events.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type {
  ApiError,
  ConvertRecommendationToTaskResult,
  Garden as GardenResource,
  Recommendation,
  TodayResult,
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

function asToday(response: InjectResponse): TodayResult {
  return response.json<TodayResult>();
}

function asRecommendation(response: InjectResponse): Recommendation {
  return response.json<Recommendation>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'recommendation routes (HTTP)';
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
      payload: { name: 'Today Test Garden' },
    });

    return { token, garden: asGarden(created) };
  }

  /**
   * Seeds one eligible garden-targeted candidate of the launch harvest rule
   * (whose version the running application's catalog resolves) directly in
   * SQL — candidate and evidence in ONE transaction, because the
   * primary-evidence composite FK is checked at COMMIT.
   */
  async function seedEligibleCandidate(
    gardenId: string,
    options: { priorityContribution?: number } = {},
  ): Promise<string> {
    const candidateId = generateUuidV7();
    const evidenceId = generateUuidV7();
    const now = new Date();

    await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('tasks_recommendations.rule_version')
        .select('id')
        .where('rule_key', '=', 'lifecycle.harvest-readiness-check')
        .where('version', '=', 1)
        .executeTakeFirst();
      const ruleVersionId = existing?.id ?? generateUuidV7();
      if (existing === undefined) {
        await trx
          .insertInto('tasks_recommendations.rule_version')
          .values({
            id: ruleVersionId,
            rule_key: 'lifecycle.harvest-readiness-check',
            version: 1,
            safety_tier: 'ordinary_care',
          })
          .execute();
      }

      await trx
        .insertInto('tasks_recommendations.recommendation_candidate')
        .values({
          id: candidateId,
          garden_id: gardenId,
          target_kind: 'garden',
          target_garden_area_id: null,
          target_plant_id: null,
          care_category: 'harvest',
          explanation: 'Seeded deterministic explanation.',
          rule_version_id: ruleVersionId,
          safety_tier: 'ordinary_care',
          state: 'eligible',
          urgency: 'high',
          window_start: new Date(now.getTime() - 60 * 60 * 1000),
          window_end: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
          primary_evidence_id: evidenceId,
          supersedes_candidate_id: null,
          presented_at: null,
          revision: 2,
        })
        .execute();
      await trx
        .insertInto('tasks_recommendations.recommendation_evidence')
        .values({
          id: evidenceId,
          candidate_id: candidateId,
          evidence_kind: 'garden_context',
          source_observation_id: null,
          source_task_id: null,
          source_plant_id: null,
          source_weather_record_id: null,
          fact_key: 'garden.context',
          fact_value: sql`'{"seeded": true}'::jsonb`,
        })
        .execute();
      await trx
        .insertInto('tasks_recommendations.recommendation_priority_factor')
        .values({
          id: generateUuidV7(),
          candidate_id: candidateId,
          factor_kind: 'urgency_window',
          factor_value: sql`${JSON.stringify({
            contribution: options.priorityContribution ?? 30,
            basis: { seeded: true },
          })}::jsonb`,
        })
        .execute();
    });

    return candidateId;
  }

  function commandHeaders(token: string, revision: number) {
    return {
      ...bearer(token),
      'idempotency-key': generateUuidV7(),
      'if-match': `"${String(revision)}"`,
    };
  }

  it('rejects an unauthenticated Today request with 401', async () => {
    const { garden } = await createGardenAsOwner();
    const response = await app.inject({ method: 'GET', url: `/v1/gardens/${garden.id}/today` });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an out-of-bounds limit with 400', async () => {
    const { token, garden } = await createGardenAsOwner();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/today?limit=0`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects completing a recommendation without an Idempotency-Key with 400', async () => {
    const { token, garden } = await createGardenAsOwner();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${generateUuidV7()}/complete`,
      headers: { ...bearer(token), 'if-match': '"2"' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects postponing a recommendation without an If-Match with 400', async () => {
    const { token, garden } = await createGardenAsOwner();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${generateUuidV7()}/postpone`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('reports acting on an unknown recommendation as 404 with the stable code', async () => {
    const { token, garden } = await createGardenAsOwner();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${generateUuidV7()}/dismiss`,
      headers: commandHeaders(token, 2),
    });
    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('tasks_recommendations.recommendation.not_found');
  });

  it('serves Today, marks first presentation, and runs the feedback loop over real HTTP', async () => {
    const { token, garden } = await createGardenAsOwner();
    const highId = await seedEligibleCandidate(garden.id, { priorityContribution: 60 });
    const lowId = await seedEligibleCandidate(garden.id, { priorityContribution: 20 });

    const first = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/today`,
      headers: bearer(token),
    });
    expect(first.statusCode).toBe(200);
    const today = asToday(first);
    expect(today.gardenId).toBe(garden.id);
    // Ordered by the score re-derived from the stored factors.
    expect(today.items.map((item) => [item.id, item.priorityScore])).toEqual([
      [highId, 60],
      [lowId, 20],
    ]);
    const item = today.items[0];
    expect(item).toMatchObject({
      state: 'presented',
      revision: 3,
      ruleKey: 'lifecycle.harvest-readiness-check',
      ruleVersion: 1,
      actionTitle: 'Check ripeness and harvest what is ready',
      explanation: 'Seeded deterministic explanation.',
      targetDisplayName: null,
    });
    expect(item?.presentedAt).not.toBeNull();
    expect(item?.evidence).toHaveLength(1);
    expect(item?.priorityFactors).toEqual([
      { kind: 'urgency_window', contribution: 60, basis: { seeded: true } },
    ]);

    // The serving request logged the presentation flow (P7-ANALYTICS-01):
    // counts only, and the exact field set — nothing about the garden, the
    // rules, or the user rides along.
    const servedEvent = lastLogEvent(logRecords, 'recommendations.today_served');
    expect(servedEvent).toMatchObject({ itemsServed: 2, firstPresentations: 2, limit: 10 });
    expect(emittedPayloadKeys(servedEvent)).toEqual([
      'event',
      'firstPresentations',
      'itemsServed',
      'limit',
    ]);

    // The repeat read is stable: no second presentation, same revisions.
    const repeat = asToday(
      await app.inject({
        method: 'GET',
        url: `/v1/gardens/${garden.id}/today`,
        headers: bearer(token),
      }),
    );
    expect(repeat.items.map((entry) => [entry.id, entry.revision])).toEqual([
      [highId, 3],
      [lowId, 3],
    ]);
    // The repeat read logs too — same set served, zero NEW presentations.
    expect(lastLogEvent(logRecords, 'recommendations.today_served')).toMatchObject({
      itemsServed: 2,
      firstPresentations: 0,
      limit: 10,
    });

    // Complete the top item; a stale retry of the same revision conflicts.
    const completed = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${highId}/complete`,
      headers: commandHeaders(token, 3),
    });
    expect(completed.statusCode).toBe(200);
    expect(asRecommendation(completed)).toMatchObject({ state: 'completed', revision: 4 });
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${highId}/complete`,
      headers: commandHeaders(token, 3),
    });
    expect([409, 412]).toContain(stale.statusCode);

    // Dismiss the second, then flag it irrelevant — feedback-only, no bump.
    const dismissed = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${lowId}/dismiss`,
      headers: commandHeaders(token, 3),
    });
    expect(dismissed.statusCode).toBe(200);
    expect(asRecommendation(dismissed)).toMatchObject({ state: 'rejected', revision: 4 });
    const irrelevant = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${lowId}/mark-irrelevant`,
      headers: commandHeaders(token, 4),
    });
    expect(irrelevant.statusCode).toBe(200);
    expect(asRecommendation(irrelevant)).toMatchObject({ state: 'rejected', revision: 4 });

    // The completed and rejected items no longer appear in Today.
    const drained = asToday(
      await app.inject({
        method: 'GET',
        url: `/v1/gardens/${garden.id}/today`,
        headers: bearer(token),
      }),
    );
    expect(drained.items).toEqual([]);
    // The empty read still logs — the "opened Today, found nothing" case is
    // exactly what no candidate row can ever record (P7-ANALYTICS-01).
    expect(lastLogEvent(logRecords, 'recommendations.today_served')).toMatchObject({
      itemsServed: 0,
      firstPresentations: 0,
    });
  });

  it('postpones with a horizon and converts another into a task over real HTTP', async () => {
    const { token, garden } = await createGardenAsOwner();
    const postponeId = await seedEligibleCandidate(garden.id, { priorityContribution: 50 });
    const convertId = await seedEligibleCandidate(garden.id, { priorityContribution: 40 });

    await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/today`,
      headers: bearer(token),
    });

    const postponedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const postponed = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${postponeId}/postpone`,
      headers: commandHeaders(token, 3),
      payload: { postponedUntil },
    });
    expect(postponed.statusCode).toBe(200);
    expect(asRecommendation(postponed)).toMatchObject({ state: 'postponed', revision: 4 });
    const feedback = await db
      .selectFrom('tasks_recommendations.recommendation_feedback')
      .select(['feedback_kind', 'postponed_until'])
      .where('candidate_id', '=', postponeId)
      .execute();
    expect(feedback).toEqual([
      { feedback_kind: 'postponed', postponed_until: new Date(postponedUntil) },
    ]);

    const converted = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/recommendations/${convertId}/convert-to-task`,
      headers: commandHeaders(token, 3),
    });
    expect(converted.statusCode).toBe(201);
    const result = converted.json<ConvertRecommendationToTaskResult>();
    expect(result.recommendation).toMatchObject({ id: convertId, state: 'completed' });
    expect(result.task).toMatchObject({
      gardenId: garden.id,
      title: 'Check ripeness and harvest what is ready',
      notes: 'Seeded deterministic explanation.',
      status: 'planned',
      source: 'suggested',
      urgency: 'high',
    });
    const taskRow = await db
      .selectFrom('tasks_recommendations.task')
      .select(['source', 'origin_recommendation_id'])
      .where('id', '=', result.task.id)
      .executeTakeFirstOrThrow();
    expect(taskRow).toEqual({ source: 'suggested', origin_recommendation_id: convertId });
  });
});
