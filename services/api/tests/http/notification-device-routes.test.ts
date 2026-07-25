/**
 * Full HTTP-level contract tests for the P7-NOTIF-02 surfaces: the
 * device-registration routes (`PUT`/`DELETE
 * /notification-devices/{deviceInstallationId}`) and the internal
 * OIDC-verified delivery-sweep endpoint — the real Fastify application,
 * the real authentication plugin, and a real migrated PostgreSQL
 * database, mirroring `notification-routes.test.ts`'s structure. The FCM
 * edge is the scripted fake at the port boundary (the
 * `media-processing-callback` posture for machine identities, applied to
 * the provider).
 *
 * Includes the one flow only HTTP can prove end to end: a relayed domain
 * event plus a registered device becoming an FCM send through the sweep
 * endpoint, with the invalid-token path disabling the device durably.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `Notifications`;
 * implementation-plan.md work package P7-NOTIF-02.
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
import type { Garden as GardenResource, NotificationDevice } from '@verdery/api-contracts';
import { RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE } from '@verdery/api-contracts';
import { UnauthenticatedError } from '../../src/platform/errors/application-error.js';
import { FakePushMessageSender } from '../../src/modules/notifications/application/notification-test-doubles.js';
import type { NotificationDeliverySweepResult } from '../../src/modules/notifications/public.js';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from '../../src/platform/tasks/cloud-tasks-invocation-verifier.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';

const SUITE_NAME = 'notification device and delivery routes (HTTP)';
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

/** Accepts exactly the suite's worker token — the machine-identity half, faked at the port boundary like every callback suite. */
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
  let pushMessageSender: FakePushMessageSender;
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
    pushMessageSender = new FakePushMessageSender();
    app = await buildTestApplication({
      database,
      tokenVerifier,
      cloudTasksInvocationVerifier: workerVerifier,
      pushMessageSender,
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
      payload: { name: 'Delivery Test Garden' },
    });

    return { token, garden: created.json<GardenResource>() };
  }

  it('rejects unauthenticated device requests with 401', async () => {
    const url = `/v1/notification-devices/${generateUuidV7()}`;
    for (const method of ['PUT', 'DELETE'] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode).toBe(401);
    }
  });

  it('rejects an unauthenticated delivery-sweep trigger with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/internal/notification-delivery/sweep',
    });
    expect(response.statusCode).toBe(401);
  });

  it('registers, refreshes, and removes a device — token never echoed, environment stamped server-side', async () => {
    const { token } = await createGardenAsOwner();
    const installationId = generateUuidV7();

    const registered = await app.inject({
      method: 'PUT',
      url: `/v1/notification-devices/${installationId}`,
      headers: bearer(token),
      payload: { platform: 'ios', fcmToken: 'an-fcm-registration-token' },
    });
    expect(registered.statusCode).toBe(200);
    const resource = registered.json<NotificationDevice>();
    expect(resource).toMatchObject({ installationId, platform: 'ios', status: 'active' });
    expect(registered.body).not.toContain('an-fcm-registration-token');

    // The stored row carries the token and the SERVER's environment.
    const stored = await db
      .selectFrom('notifications.notification_device')
      .selectAll()
      .where('installation_id', '=', installationId)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({
      fcm_token: 'an-fcm-registration-token',
      environment: 'development',
      provider: 'fcm',
    });

    // Refresh converges: same row, rotated token, same 200 shape.
    const refreshed = await app.inject({
      method: 'PUT',
      url: `/v1/notification-devices/${installationId}`,
      headers: bearer(token),
      payload: { platform: 'ios', fcmToken: 'a-rotated-token' },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json<NotificationDevice>().registeredAt).toBe(resource.registeredAt);

    // Removal is 204, and a repeat removal converges to the same 204.
    for (let call = 0; call < 2; call += 1) {
      const removed = await app.inject({
        method: 'DELETE',
        url: `/v1/notification-devices/${installationId}`,
        headers: bearer(token),
      });
      expect(removed.statusCode).toBe(204);
    }
    const remaining = await db
      .selectFrom('notifications.notification_device')
      .select('id')
      .where('installation_id', '=', installationId)
      .execute();
    expect(remaining).toHaveLength(0);
  });

  it('rejects malformed registrations with 400', async () => {
    const { token } = await createGardenAsOwner();
    const url = `/v1/notification-devices/${generateUuidV7()}`;

    const badPlatform = await app.inject({
      method: 'PUT',
      url,
      headers: bearer(token),
      payload: { platform: 'android', fcmToken: 'token' },
    });
    expect(badPlatform.statusCode).toBe(400);

    const emptyToken = await app.inject({
      method: 'PUT',
      url,
      headers: bearer(token),
      payload: { platform: 'ios', fcmToken: '' },
    });
    expect(emptyToken.statusCode).toBe(400);

    const badInstallation = await app.inject({
      method: 'PUT',
      url: '/v1/notification-devices/not-a-uuid',
      headers: bearer(token),
      payload: { platform: 'ios', fcmToken: 'token' },
    });
    expect(badInstallation.statusCode).toBe(400);
  });

  it('carries a relayed event through the sweep into an FCM send, and disables the device on an invalid-token verdict', async () => {
    const { token, garden } = await createGardenAsOwner();
    const installationId = generateUuidV7();
    await app.inject({
      method: 'PUT',
      url: `/v1/notification-devices/${installationId}`,
      headers: bearer(token),
      payload: { platform: 'ios', fcmToken: 'http-flow-token' },
    });

    // One eligible candidate + its event, exactly as the relay posts it.
    const candidateId = generateUuidV7();
    const evidenceId = generateUuidV7();
    await db.transaction().execute(async (trx) => {
      const ruleVersionId = generateUuidV7();
      await trx
        .insertInto('tasks_recommendations.rule_version')
        .values({
          id: ruleVersionId,
          rule_key: 'lifecycle.harvest-readiness-check',
          version: 1,
          safety_tier: 'ordinary_care',
        })
        .execute();
      await trx
        .insertInto('tasks_recommendations.recommendation_candidate')
        .values({
          id: candidateId,
          garden_id: garden.id,
          target_kind: 'garden',
          target_garden_area_id: null,
          target_plant_id: null,
          care_category: 'harvest',
          explanation: 'Seeded deterministic explanation.',
          rule_version_id: ruleVersionId,
          safety_tier: 'ordinary_care',
          state: 'eligible',
          urgency: 'high',
          window_start: new Date(Date.now() - 60 * 60 * 1000),
          window_end: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
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
    const event = await app.inject({
      method: 'POST',
      url: '/v1/internal/notifications/events',
      headers: { authorization: WORKER_TOKEN, 'content-type': 'application/json' },
      payload: {
        id: generateUuidV7(),
        eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
        payload: {
          candidateId,
          gardenId: garden.id,
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
      },
    });
    expect(event.statusCode).toBe(200);

    // First sweep: the pending intent becomes an FCM send.
    const sweep = await app.inject({
      method: 'POST',
      url: '/v1/internal/notification-delivery/sweep',
      headers: { authorization: WORKER_TOKEN },
    });
    expect(sweep.statusCode).toBe(200);
    const summary = sweep.json<NotificationDeliverySweepResult>();
    expect(summary).toMatchObject({ intentsClaimed: 1, intentsSent: 1 });
    expect(pushMessageSender.sent.some((message) => message.token === 'http-flow-token')).toBe(
      true,
    );

    // A second event for a NEW candidate, but the token has died since:
    // the sweep disables the device durably and fails the intent.
    pushMessageSender.scriptOutcome('http-flow-token', {
      kind: 'token_invalid',
      errorCode: 'messaging/registration-token-not-registered',
    });
    const secondCandidate = generateUuidV7();
    const secondEvidence = generateUuidV7();
    await db.transaction().execute(async (trx) => {
      const ruleVersion = await trx
        .selectFrom('tasks_recommendations.rule_version')
        .select('id')
        .where('rule_key', '=', 'lifecycle.harvest-readiness-check')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('tasks_recommendations.recommendation_candidate')
        .values({
          id: secondCandidate,
          garden_id: garden.id,
          target_kind: 'garden',
          target_garden_area_id: null,
          target_plant_id: null,
          care_category: 'harvest',
          explanation: 'Second seeded explanation.',
          rule_version_id: ruleVersion.id,
          safety_tier: 'ordinary_care',
          state: 'eligible',
          urgency: 'high',
          window_start: new Date(Date.now() - 60 * 60 * 1000),
          window_end: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          primary_evidence_id: secondEvidence,
          supersedes_candidate_id: null,
          presented_at: null,
          revision: 2,
        })
        .execute();
      await trx
        .insertInto('tasks_recommendations.recommendation_evidence')
        .values({
          id: secondEvidence,
          candidate_id: secondCandidate,
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
    await app.inject({
      method: 'POST',
      url: '/v1/internal/notifications/events',
      headers: { authorization: WORKER_TOKEN, 'content-type': 'application/json' },
      payload: {
        id: generateUuidV7(),
        eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
        payload: {
          candidateId: secondCandidate,
          gardenId: garden.id,
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
      },
    });

    const failingSweep = await app.inject({
      method: 'POST',
      url: '/v1/internal/notification-delivery/sweep',
      headers: { authorization: WORKER_TOKEN },
    });
    const failingSummary = failingSweep.json<NotificationDeliverySweepResult>();
    expect(failingSummary).toMatchObject({
      devicesDisabled: 1,
      intentsFailed: { all_tokens_invalid: 1 },
    });

    const device = await db
      .selectFrom('notifications.notification_device')
      .select(['status', 'disabled_reason'])
      .where('installation_id', '=', installationId)
      .executeTakeFirstOrThrow();
    expect(device).toEqual({ status: 'disabled', disabled_reason: 'token_invalid' });
  });
});
