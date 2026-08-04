/**
 * Emission-point tests for the plant/candidate-side plant-intelligence
 * analytics events (P11-OBS-01): `plants.actual_created`,
 * `plants.candidate_added`, `plants.identification_suggested`,
 * `plants.identification_confirmed`, `plants.search_completed`,
 * `plants.candidates_listed`, `plants.candidate_suitability_reviewed`,
 * `plants.candidate_converted` — the real Fastify application, the real
 * authentication plugin, and a real migrated PostgreSQL database, mirroring
 * `plant-routes.test.ts`/`candidate-routes.test.ts`'s own harness (those
 * suites own the routes' CONTRACT behavior; this one pins what the routes
 * LOG).
 *
 * Each event's emitted line is asserted as an exact field set — the
 * catalog-level allowlists live in
 * `tests/analytics/plant-intelligence-analytics.test.ts`; this suite
 * proves the WIRE matches them, the identical two-layer proof
 * `notification-analytics-events.test.ts` established for P7-ANALYTICS-01.
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
import type { Garden as GardenResource, Plant, PlantCandidate } from '@verdery/api-contracts';
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

function asCandidate(response: InjectResponse): PlantCandidate {
  return response.json<PlantCandidate>();
}

const SUITE_NAME = 'plant analytics events (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents — the identical `plant-routes.test.ts` fake. */
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
      payload: { name: 'Plant Analytics Test Garden' },
    });

    return { token, garden: asGarden(created) };
  }

  it('logs plants.actual_created with counts and flags only', async () => {
    const { token, garden } = await createGardenAsOwner();

    const created = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Tomato', groupingKind: 'individual' },
    });
    expect(created.statusCode).toBe(201);

    const event = lastLogEvent(logRecords, 'plants.actual_created');
    expect(event).toMatchObject({ kind: 'actual', groupingKind: 'individual', identified: false });
    expect(emittedPayloadKeys(event)).toEqual(['event', 'groupingKind', 'identified', 'kind']);
  });

  it('logs plants.identification_suggested (application layer) with no provider configured — a deterministic "no candidate" bucket', async () => {
    const { token, garden } = await createGardenAsOwner();

    const membership = await db
      .selectFrom('collaboration.membership')
      .select('profile_id')
      .where('garden_id', '=', garden.id)
      .where('role', '=', 'owner')
      .executeTakeFirstOrThrow();
    const clock = { now: () => new Date() };
    const { RegisterMediaRecord } =
      await import('../../src/modules/media/application/register-media-record.js');
    const { KyselyMediaUnitOfWork } =
      await import('../../src/modules/media/persistence/kysely-media-unit-of-work.js');
    const { KyselyIdempotencyStore } =
      await import('../../src/platform/idempotency/kysely-idempotency-store.js');
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const media = await registerMediaRecord.execute(
      membership.profile_id,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'plant.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      generateUuidV7(),
    );
    await db
      .updateTable('media.media_record')
      .set({
        garden_id: garden.id,
        upload_state: 'available',
        // A completed upload always has a stored object behind it; without
        // one, nothing can read the photo the row claims to be.
        bucket_name: 'test-user-media',
        object_key: `gardens/${garden.id}/media/${media.id}`,
      })
      .where('id', '=', media.id)
      .execute();

    const created = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants/from-photo`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { photoMediaId: media.id },
    });
    expect(created.statusCode).toBe(201);

    const event = lastLogEvent(logRecords, 'plants.identification_suggested');
    // No AI provider is configured in this test environment
    // (`compose-integrations.ts`'s own documented "every environment
    // today" `noProviderConfigured` degradation) — a real, deterministic
    // signal, not a fake.
    expect(event).toMatchObject({
      hadCandidate: false,
      hasCatalogMatch: false,
      confidenceBucket: 'none',
    });
    expect(emittedPayloadKeys(event)).toEqual([
      'confidenceBucket',
      'event',
      'hadCandidate',
      'hasCatalogMatch',
    ]);
  });

  it('logs plants.identification_confirmed with hasCatalogMatch read off the response, no second query', async () => {
    const { token, garden } = await createGardenAsOwner();
    const created = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Unidentified plant', groupingKind: 'individual' },
    });
    const plant = asPlant(created);

    const membership = await db
      .selectFrom('collaboration.membership')
      .select('profile_id')
      .where('garden_id', '=', garden.id)
      .where('role', '=', 'owner')
      .executeTakeFirstOrThrow();
    const clock = { now: () => new Date() };
    const { RegisterMediaRecord } =
      await import('../../src/modules/media/application/register-media-record.js');
    const { KyselyMediaUnitOfWork } =
      await import('../../src/modules/media/persistence/kysely-media-unit-of-work.js');
    const { KyselyIdempotencyStore } =
      await import('../../src/platform/idempotency/kysely-idempotency-store.js');
    const registerMediaRecord = new RegisterMediaRecord(
      new KyselyIdempotencyStore(db, clock),
      new KyselyMediaUnitOfWork(db, clock),
      clock,
    );
    const media = await registerMediaRecord.execute(
      membership.profile_id,
      {
        mediaClass: 'garden_photo',
        displayFilename: 'plant.jpg',
        declaredContentType: 'image/jpeg',
        declaredByteSize: 123_456,
      },
      generateUuidV7(),
    );
    await db
      .updateTable('media.media_record')
      .set({
        garden_id: garden.id,
        upload_state: 'available',
        // A completed upload always has a stored object behind it; without
        // one, nothing can read the photo the row claims to be.
        bucket_name: 'test-user-media',
        object_key: `gardens/${garden.id}/media/${media.id}`,
      })
      .where('id', '=', media.id)
      .execute();
    const plantPhotoId = generateUuidV7();
    await db
      .insertInto('plants_inventory.plant_photo')
      .values({ id: plantPhotoId, plant_id: plant.id, media_id: media.id, is_primary: true })
      .execute();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: generateUuidV7(),
        scientific_name: 'Ocimum basilicum',
        common_name: 'Basil',
        variety_name: null,
        source: 'system_catalog',
        created_by_profile_id: null,
      })
      .execute();
    const identificationId = generateUuidV7();
    await db
      .insertInto('plants_inventory.plant_identification')
      .values({
        id: identificationId,
        plant_id: plant.id,
        plant_photo_id: plantPhotoId,
        suggested_taxonomy_id: null,
        suggested_common_name: 'Basil',
        confidence_score: 0.42,
      })
      .execute();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants/${plant.id}/identification/${identificationId}/confirm`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': String(plant.revision),
      },
    });
    expect(response.statusCode).toBe(200);

    const event = lastLogEvent(logRecords, 'plants.identification_confirmed');
    expect(event).toMatchObject({ hasCatalogMatch: false });
    expect(emittedPayloadKeys(event)).toEqual(['event', 'hasCatalogMatch']);
  });

  it('logs plants.search_completed with result counts and filter-presence flags, never the query text', async () => {
    const { token, garden } = await createGardenAsOwner();
    await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Basil', groupingKind: 'individual' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plants?query=basil&status=active`,
      headers: bearer(token),
    });
    expect(response.statusCode).toBe(200);

    const event = lastLogEvent(logRecords, 'plants.search_completed');
    expect(event).toMatchObject({
      resultCount: 1,
      isZeroResult: false,
      hasQueryText: true,
      hasStatusFilter: true,
      hasLifecycleStageFilter: false,
      hasGroupingKindFilter: false,
      hasIdentifiedFilter: false,
    });
    expect(emittedPayloadKeys(event)).toEqual([
      'event',
      'hasGroupingKindFilter',
      'hasIdentifiedFilter',
      'hasLifecycleStageFilter',
      'hasQueryText',
      'hasStatusFilter',
      'isZeroResult',
      'resultCount',
    ]);
    expect(JSON.stringify(event)).not.toContain('basil');
  });

  it('logs plants.candidate_added, plants.candidates_listed, plants.candidate_suitability_reviewed, and plants.candidate_converted across one candidate lifecycle', async () => {
    const { token, garden } = await createGardenAsOwner();

    const added = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Fig tree', groupingKind: 'individual', priority: 'high' },
    });
    expect(added.statusCode).toBe(201);
    const candidate = asCandidate(added);

    const addedEvent = lastLogEvent(logRecords, 'plants.candidate_added');
    expect(addedEvent).toMatchObject({
      kind: 'candidate',
      groupingKind: 'individual',
      identified: false,
      hasPriority: true,
      isAlternative: false,
    });
    expect(emittedPayloadKeys(addedEvent)).toEqual([
      'event',
      'groupingKind',
      'hasPriority',
      'identified',
      'isAlternative',
      'kind',
    ]);

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates`,
      headers: bearer(token),
    });
    expect(listed.statusCode).toBe(200);
    const listedEvent = lastLogEvent(logRecords, 'plants.candidates_listed');
    expect(listedEvent).toMatchObject({ resultCount: 1, isZeroResult: false });
    expect(emittedPayloadKeys(listedEvent)).toEqual([
      'event',
      'hasIdentifiedFilter',
      'hasPriorityFilter',
      'hasQueryText',
      'hasStatusFilter',
      'isZeroResult',
      'resultCount',
    ]);

    const recalculated = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/suitability`,
      headers: bearer(token),
    });
    expect(recalculated.statusCode).toBe(201);
    const recalculatedEvent = lastLogEvent(logRecords, 'plants.candidate_suitability_reviewed');
    expect(recalculatedEvent).toMatchObject({ recalculated: true });
    expect(emittedPayloadKeys(recalculatedEvent)).toEqual([
      'event',
      'findingCounts',
      'recalculated',
    ]);

    const reviewed = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/suitability`,
      headers: bearer(token),
    });
    expect(reviewed.statusCode).toBe(200);
    const reviewedEvent = lastLogEvent(logRecords, 'plants.candidate_suitability_reviewed');
    expect(reviewedEvent).toMatchObject({ recalculated: false });
    expect(emittedPayloadKeys(reviewedEvent)).toEqual(['event', 'findingCounts', 'recalculated']);

    const converted = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plant-candidates/${candidate.id}/convert`,
      headers: {
        ...bearer(token),
        'idempotency-key': generateUuidV7(),
        'if-match': String(candidate.revision),
      },
      payload: {},
    });
    expect(converted.statusCode).toBe(201);
    const convertedEvent = lastLogEvent(logRecords, 'plants.candidate_converted');
    expect(convertedEvent).toMatchObject({ groupingKind: 'individual', hasPriority: true });
    expect(emittedPayloadKeys(convertedEvent)).toEqual(['event', 'groupingKind', 'hasPriority']);
  });
});
