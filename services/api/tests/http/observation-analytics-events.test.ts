/**
 * Emission-point tests for the observation/health-suggestion-side
 * plant-intelligence analytics events (P11-OBS-01):
 * `observations.recorded`, `observations.corrected`,
 * `observations.health_suggestion_produced`,
 * `observations.health_disposition_set` — the real Fastify application, the
 * real authentication plugin, and a real migrated PostgreSQL database,
 * mirroring `observation-routes.test.ts`'s own harness (that suite owns the
 * routes' CONTRACT behavior; this one pins what the routes LOG).
 *
 * Each event's emitted line is asserted as an exact field set — the
 * catalog-level allowlists live in
 * `tests/analytics/plant-intelligence-analytics.test.ts`; this suite
 * proves the WIRE matches them.
 *
 * Source: architecture/observability-and-analytics.md; implementation-plan.md
 * work package P11-OBS-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApplication } from '../support/application.js';
import { emittedPayloadKeys, lastLogEvent } from '../support/log-events.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type { Garden as GardenResource, Observation } from '@verdery/api-contracts';
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

function asObservation(response: InjectResponse): Observation {
  return response.json<Observation>();
}

const SUITE_NAME = 'observation analytics events (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents — the identical `observation-routes.test.ts` fake. */
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

  async function createGardenAsOwner(): Promise<{
    token: string;
    garden: GardenResource;
    firebaseUid: string;
  }> {
    const token = randomUUID();
    const firebaseUid = randomUUID();
    tokenVerifier.registerIdToken(token, firebaseUid);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Observation Analytics Test Garden' },
    });

    return { token, garden: asGarden(created), firebaseUid };
  }

  /** The owner's profile row, created by the authentication middleware on that first authenticated request — the identical `observation-routes.test.ts` helper. */
  async function profileIdFor(firebaseUid: string): Promise<string> {
    const row = await db
      .selectFrom('identity_access.profile')
      .select('id')
      .where('firebase_uid', '=', firebaseUid)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  it('logs observations.recorded with counts and presence flags, never note/summary text', async () => {
    const { token, garden } = await createGardenAsOwner();

    const recorded = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/observations`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { noteText: 'Looks healthy and vigorous.', conditionSummary: 'Good' },
    });
    expect(recorded.statusCode).toBe(201);

    const event = lastLogEvent(logRecords, 'observations.recorded');
    expect(event).toMatchObject({
      hasPlant: false,
      photoCount: 0,
      measurementCount: 0,
      hasNote: true,
      hasConditionSummary: true,
      hasPhenologicalStage: false,
    });
    expect(emittedPayloadKeys(event)).toEqual([
      'event',
      'hasConditionSummary',
      'hasNote',
      'hasPhenologicalStage',
      'hasPlant',
      'measurementCount',
      'photoCount',
    ]);
    expect(JSON.stringify(event)).not.toContain('vigorous');
  });

  it('logs observations.corrected with the closed correctionKind vocabulary, never note text', async () => {
    const { token, garden } = await createGardenAsOwner();
    const recorded = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/observations`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { noteText: 'First growth spurt.' },
    });
    const observation = asObservation(recorded);

    const corrected = await app.inject({
      method: 'POST',
      url: `/v1/observations/${observation.id}/corrections`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { correctionKind: 'amendment', noteText: 'Actually, mixed growth.' },
    });
    expect(corrected.statusCode).toBe(201);

    const event = lastLogEvent(logRecords, 'observations.corrected');
    expect(event).toMatchObject({
      correctionKind: 'amendment',
      photoCount: 0,
      measurementCount: 0,
    });
    expect(emittedPayloadKeys(event)).toEqual([
      'correctionKind',
      'event',
      'measurementCount',
      'photoCount',
    ]);
    expect(JSON.stringify(event)).not.toContain('mixed growth');
  });

  it('logs observations.health_suggestion_produced and observations.health_disposition_set for a photo-attached observation', async () => {
    const { token, garden, firebaseUid } = await createGardenAsOwner();
    const profileId = await profileIdFor(firebaseUid);

    const mediaId = generateUuidV7();
    await db
      .insertInto('media.media_record')
      .values({
        id: mediaId,
        garden_id: garden.id,
        uploaded_by_profile_id: profileId,
        media_class: 'garden_photo',
        display_filename: 'leaf.jpg',
        declared_content_type: 'image/jpeg',
        declared_byte_size: 100,
        bucket_name: 'test-user-media',
        object_key: `ab/${mediaId}/${generateUuidV7()}`,
        upload_state: 'available',
        sensitivity_classification: 'sensitive',
      })
      .execute();

    const recorded = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/observations`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { photos: [{ mediaId, purpose: 'whole_plant' }] },
    });
    expect(recorded.statusCode).toBe(201);
    const observation = asObservation(recorded);
    const analysisResultId = observation.photos[0]?.analysisResults[0]?.id;
    expect(analysisResultId).toBeDefined();

    // No AI provider is configured in this test environment — a real,
    // deterministic "no analysis" outcome, not a fake — so exactly one
    // analysis result is produced, no model reached, and the honest
    // "we don't know, ask for more evidence" default applies.
    const producedEvent = lastLogEvent(logRecords, 'observations.health_suggestion_produced');
    expect(producedEvent).toMatchObject({
      analysisCount: 1,
      requestedAdditionalEvidenceCount: 1,
      hasModelCount: 0,
    });
    expect(emittedPayloadKeys(producedEvent)).toEqual([
      'analysisCount',
      'event',
      'hasModelCount',
      'requestedAdditionalEvidenceCount',
      'safetyClassCounts',
    ]);

    const disposed = await app.inject({
      method: 'POST',
      url: `/v1/observations/analysis-results/${analysisResultId}/disposition`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { disposition: 'accepted_as_observation' },
    });
    expect(disposed.statusCode).toBe(200);

    const dispositionEvent = lastLogEvent(logRecords, 'observations.health_disposition_set');
    expect(dispositionEvent).toMatchObject({ disposition: 'accepted_as_observation' });
    expect(emittedPayloadKeys(dispositionEvent)).toEqual(['disposition', 'event']);
  });
});
