/**
 * Emission-point tests for the notification-side care-loop analytics
 * events (P7-ANALYTICS-01): `notifications.event_processed`,
 * `notifications.intents_expired`, and `notifications.preferences_updated`
 * — the real Fastify application, the real authentication plugin, and a
 * real migrated PostgreSQL database, mirroring
 * `notification-routes.test.ts`'s harness exactly (that suite owns the
 * routes' CONTRACT behavior; this one pins what the routes LOG).
 *
 * Each event's emitted line is asserted as an exact field set — the
 * consent boundary made mechanical: these are operational counters over
 * the server's own records, so no user identity, recipient identity,
 * preference values, or content may ride along, and a new field cannot
 * ship without being consciously admitted here. The catalog-level
 * allowlists live in `tests/analytics/care-loop-analytics.test.ts`; this
 * suite proves the WIRE matches them.
 *
 * Source: architecture/observability-and-analytics.md, sections 10-11 and
 * the P7-ANALYTICS-01 subsection; implementation-plan.md work package
 * P7-ANALYTICS-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication } from '../support/application.js';
import { emittedPayloadKeys, lastLogEvent } from '../support/log-events.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type {
  Garden as GardenResource,
  NotificationEventProcessingSummary,
  NotificationListResult,
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

const SUITE_NAME = 'notification analytics events (HTTP)';
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
      cloudTasksInvocationVerifier: workerVerifier,
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
      payload: { name: 'Analytics Test Garden' },
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
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<NotificationEventProcessingSummary>();
  }

  it('logs `notifications.event_processed` with counts and the opaque event id only', async () => {
    const { garden } = await createGardenAsOwner();
    const candidateId = await seedEligibleCandidate(garden.id);

    await postEvent(garden.id, candidateId);

    const processed = lastLogEvent(logRecords, 'notifications.event_processed');
    expect(processed).toMatchObject({
      eventType: RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE,
      recipientsConsidered: 1,
      intentsCreated: 1,
      intentsDeduplicated: 0,
      priorIntentsSuperseded: 0,
      suppressed: {},
    });
    expect(emittedPayloadKeys(processed)).toEqual([
      'event',
      'eventType',
      'intentsCreated',
      'intentsDeduplicated',
      'priorIntentsSuperseded',
      'recipientsConsidered',
      'sourceEventId',
      'suppressed',
    ]);

    // A replayed delivery logs the dedup outcome the same way.
    await postEvent(garden.id, candidateId);
    expect(lastLogEvent(logRecords, 'notifications.event_processed')).toMatchObject({
      intentsCreated: 0,
      intentsDeduplicated: 1,
    });
  });

  it('logs `notifications.intents_expired` when — and only when — an inbox read durably closes past-expiry intents', async () => {
    const { token, garden } = await createGardenAsOwner();
    const candidateId = await seedEligibleCandidate(garden.id);
    await postEvent(garden.id, candidateId);

    // A read with nothing to expire logs nothing.
    const before = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: bearer(token),
    });
    expect(before.json<NotificationListResult>().items).toHaveLength(1);
    expect(lastLogEvent(logRecords, 'notifications.intents_expired')).toBeUndefined();

    // Age the pending intent past its expiry, as delivery-sweep time would.
    await db
      .updateTable('notifications.notification_intent')
      .set({ expires_at: new Date(Date.now() - 60 * 1000) })
      .where('recommendation_candidate_id', '=', candidateId)
      .execute();

    const after = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: bearer(token),
    });
    expect(after.json<NotificationListResult>().items).toHaveLength(0);

    const expired = lastLogEvent(logRecords, 'notifications.intents_expired');
    expect(expired).toMatchObject({ intentsExpired: 1 });
    expect(emittedPayloadKeys(expired)).toEqual(['event', 'intentsExpired']);
  });

  it('logs `notifications.preferences_updated` with revision and counts — never the preference values', async () => {
    const { token, garden } = await createGardenAsOwner();

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

    const updated = lastLogEvent(logRecords, 'notifications.preferences_updated');
    expect(updated).toMatchObject({ revision: 1, entryCount: 1, hasQuietHours: true });
    expect(emittedPayloadKeys(updated)).toEqual([
      'entryCount',
      'event',
      'hasQuietHours',
      'revision',
    ]);
    // The window minutes, the zone, and the per-garden entry values stay
    // out of the line entirely — the record proves it by field absence.
    const serialized = JSON.stringify(updated);
    expect(serialized).not.toContain('Europe/Berlin');
    expect(serialized).not.toContain(garden.id);
  });
});
