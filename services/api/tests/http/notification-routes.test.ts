/**
 * Full HTTP-level contract tests for the notification routes (P7-NOTIF-01):
 * the real Fastify application, the real authentication plugin, and a real
 * migrated PostgreSQL database — mirrors `recommendation-routes.test.ts`'s
 * structure and conventions exactly, plus the internal OIDC-verified event
 * endpoint the workers relay posts to (exercised through a fake invocation
 * verifier, the `media-processing-callback` posture).
 *
 * Transport-layer coverage plus the one flow only HTTP can prove: a domain
 * event posted to the internal endpoint becoming a caller-visible inbox
 * entry through the public surface.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Notifications`;
 * implementation-plan.md work package P7-NOTIF-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type {
  Garden as GardenResource,
  Notification,
  NotificationEventProcessingSummary,
  NotificationListResult,
  NotificationPreferencesDocument,
} from '@verdery/api-contracts';
import { RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE } from '@verdery/api-contracts';
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

const SUITE_NAME = 'notification routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const WORKER_TOKEN = 'Bearer worker-test-token';

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

/** Accepts exactly the suite's worker token — the machine-identity half of the pipeline, faked at the port boundary like every callback suite. */
const workerVerifier: CloudTasksInvocationVerifier = {
  verify: (header) =>
    header === WORKER_TOKEN
      ? Promise.resolve()
      : Promise.reject(new UnauthenticatedError('auth.unauthenticated', 'Not the worker.')),
};

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

  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Notification Test Garden' },
    });

    return { token, garden: created.json<GardenResource>() };
  }

  /** Seeds one eligible candidate (candidate + primary evidence in ONE transaction — the COMMIT-checked composite FK), returning its id. */
  async function seedEligibleCandidate(gardenId: string): Promise<string> {
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
    });

    return candidateId;
  }

  /** Posts one candidate-created event through the internal relay endpoint, as the worker would. */
  async function postEvent(
    gardenId: string,
    candidateId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<NotificationEventProcessingSummary> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/notifications/events',
      headers: { authorization: WORKER_TOKEN, 'content-type': 'application/json' },
      payload: {
        id: generateUuidV7(),
        eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
        payload: {
          candidateId,
          gardenId,
          ruleKey: 'lifecycle.harvest-readiness-check',
          ruleVersion: 1,
          targetKind: 'garden',
          targetPlantId: null,
          targetGardenAreaMapObjectId: null,
          urgency: 'high',
          priorityScore: 75,
          windowStart: null,
          windowEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          supersedesCandidateId: null,
        },
        traceId: null,
        occurredAt: new Date().toISOString(),
        ...overrides,
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<NotificationEventProcessingSummary>();
  }

  it('rejects unauthenticated inbox and preference requests with 401', async () => {
    for (const [method, url] of [
      ['GET', '/v1/notifications'],
      ['GET', '/v1/notification-preferences'],
      ['PUT', '/v1/notification-preferences'],
      [`POST`, `/v1/notifications/${generateUuidV7()}/read`],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('rejects an unauthenticated internal event post with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/notifications/events',
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('carries a relayed domain event into the caller-visible inbox, deduplicating a replay', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidateId = await seedEligibleCandidate(garden.id);

    const summary = await postEvent(garden.id, candidateId);
    expect(summary).toMatchObject({
      recipientsConsidered: 1,
      intentsCreated: 1,
      intentsDeduplicated: 0,
      priorIntentsSuperseded: 0,
    });

    // The relay's crash window: the SAME event again (same outbox id or a
    // new delivery of it) collapses on the dedup key.
    const replay = await postEvent(garden.id, candidateId);
    expect(replay).toMatchObject({ intentsCreated: 0, intentsDeduplicated: 1 });

    const inbox = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: bearer(token),
    });
    expect(inbox.statusCode).toBe(200);
    const list = inbox.json<NotificationListResult>();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      notificationType: 'care_recommendation',
      priority: 'high',
      gardenId: garden.id,
      recommendationCandidateId: candidateId,
      templateKey: 'care_recommendation.created.v1',
      deepLink: {
        kind: 'gardenToday',
        gardenId: garden.id,
        recommendationCandidateId: candidateId,
      },
      readAt: null,
      dismissedAt: null,
    });
  });

  it('marks read idempotently, then dismisses, removing the entry from the list', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidateId = await seedEligibleCandidate(garden.id);
    await postEvent(garden.id, candidateId);

    const inbox = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: bearer(token),
    });
    const notificationId = inbox.json<NotificationListResult>().items[0]?.id ?? '';

    const read = await app.inject({
      method: 'POST',
      url: `/v1/notifications/${notificationId}/read`,
      headers: bearer(token),
    });
    expect(read.statusCode).toBe(200);
    const readAt = read.json<Notification>().readAt;
    expect(readAt).not.toBeNull();

    // Repeat keeps the first stamp — no headers, no preconditions.
    const readAgain = await app.inject({
      method: 'POST',
      url: `/v1/notifications/${notificationId}/read`,
      headers: bearer(token),
    });
    expect(readAgain.json<Notification>().readAt).toBe(readAt);

    // Read entries stay listed; dismissed entries leave the list.
    const dismissed = await app.inject({
      method: 'POST',
      url: `/v1/notifications/${notificationId}/dismiss`,
      headers: bearer(token),
    });
    expect(dismissed.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: bearer(token),
    });
    expect(after.json<NotificationListResult>().items).toHaveLength(0);
  });

  it("conceals another user's notification as 404", async () => {
    const { garden } = await createGardenAsOwner();
    const candidateId = await seedEligibleCandidate(garden.id);
    await postEvent(garden.id, candidateId);

    const owner = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: bearer((await createGardenAsOwner()).token),
    });
    expect(owner.json<NotificationListResult>().items).toHaveLength(0);

    const stranger = randomUUID();
    tokenVerifier.registerIdToken(stranger, randomUUID());
    // Force the stranger's profile to exist.
    await app.inject({ method: 'GET', url: '/v1/notifications', headers: bearer(stranger) });

    const intent = await db
      .selectFrom('notifications.notification_intent')
      .select('id')
      .executeTakeFirstOrThrow();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/notifications/${intent.id}/read`,
      headers: bearer(stranger),
    });
    expect(response.statusCode).toBe(404);
  });

  it('round-trips the preference document with revision guards from 0 upward', async () => {
    const { token, garden } = await createGardenAsOwner();

    const initial = await app.inject({
      method: 'GET',
      url: '/v1/notification-preferences',
      headers: bearer(token),
    });
    expect(initial.json<NotificationPreferencesDocument>()).toEqual({
      revision: 0,
      quietHours: null,
      entries: [],
    });

    const put = await app.inject({
      method: 'PUT',
      url: '/v1/notification-preferences',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7(), 'if-match': '"0"' },
      payload: {
        quietHours: { startMinute: 1320, endMinute: 420, timeZone: 'Europe/Berlin' },
        entries: [
          {
            notificationType: 'care_recommendation',
            gardenId: garden.id,
            inAppEnabled: true,
            pushEnabled: false,
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const document = put.json<NotificationPreferencesDocument>();
    expect(document.revision).toBe(1);

    // A stale write is refused with 412.
    const stale = await app.inject({
      method: 'PUT',
      url: '/v1/notification-preferences',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7(), 'if-match': '"0"' },
      payload: { quietHours: null, entries: [] },
    });
    expect(stale.statusCode).toBe(412);

    const reread = await app.inject({
      method: 'GET',
      url: '/v1/notification-preferences',
      headers: bearer(token),
    });
    expect(reread.json<NotificationPreferencesDocument>()).toEqual(document);
  });

  it('rejects preference writes naming a garden the caller has no membership on with 404', async () => {
    const { token } = await createGardenAsOwner();
    const { garden: someoneElsesGarden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/notification-preferences',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7(), 'if-match': '"0"' },
      payload: {
        quietHours: null,
        entries: [
          {
            notificationType: 'care_recommendation',
            gardenId: someoneElsesGarden.id,
            inAppEnabled: false,
            pushEnabled: false,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects malformed preference bodies and headers with 400', async () => {
    const { token } = await createGardenAsOwner();

    // Missing If-Match entirely.
    const noRevision = await app.inject({
      method: 'PUT',
      url: '/v1/notification-preferences',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { quietHours: null, entries: [] },
    });
    expect(noRevision.statusCode).toBe(400);

    // Degenerate quiet-hours window.
    const degenerate = await app.inject({
      method: 'PUT',
      url: '/v1/notification-preferences',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7(), 'if-match': '"0"' },
      payload: { quietHours: { startMinute: 300, endMinute: 300, timeZone: null }, entries: [] },
    });
    expect(degenerate.statusCode).toBe(400);

    // Unknown notification type.
    const unknownType = await app.inject({
      method: 'PUT',
      url: '/v1/notification-preferences',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7(), 'if-match': '"0"' },
      payload: {
        quietHours: null,
        entries: [
          { notificationType: 'surprise', gardenId: null, inAppEnabled: true, pushEnabled: true },
        ],
      },
    });
    expect(unknownType.statusCode).toBe(400);

    // Out-of-bounds inbox limit.
    const badLimit = await app.inject({
      method: 'GET',
      url: '/v1/notifications?limit=0',
      headers: bearer(token),
    });
    expect(badLimit.statusCode).toBe(400);
  });

  it('suppresses events for members whose preferences disable every channel', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidateId = await seedEligibleCandidate(garden.id);

    await app.inject({
      method: 'PUT',
      url: '/v1/notification-preferences',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7(), 'if-match': '"0"' },
      payload: {
        quietHours: null,
        entries: [
          {
            notificationType: 'care_recommendation',
            gardenId: null,
            inAppEnabled: false,
            pushEnabled: false,
          },
        ],
      },
    });

    const summary = await postEvent(garden.id, candidateId);
    expect(summary).toMatchObject({
      intentsCreated: 0,
      suppressed: { channels_disabled: 1 },
    });
  });
});
