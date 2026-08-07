/**
 * Full HTTP-level contract tests for the per-garden seasonal-timing
 * acceptance surface: `GET /gardens/{gardenId}/seasonal-facts/awaiting-acceptance`
 * and `POST /gardens/{gardenId}/seasonal-facts/{factId}/accept` — the real
 * Fastify application, real authentication, and a real migrated PostgreSQL
 * database, matching `seasonal-plan-routes.test.ts`'s own harness.
 *
 * WHY THIS SUITE EXISTS. The use cases behind these routes were already
 * covered at the integration level, but their WIRE SHAPE was not covered
 * anywhere — and the wire shape is what the web client is now written
 * against. In particular `timing` is a nested
 * `SeasonalPlanTaxonomyTiming`, not twelve fields spread flat beside the
 * provenance columns, so that a person reads the months in one shape
 * whether they are deciding about them or already using them.
 *
 * Taxonomy reference and seasonal fact rows are seeded with direct SQL, the
 * same "tests seed rows directly" precedent `plants-inventory/public.ts`'s
 * own header documents: no application-layer write path exists for either.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `SeasonalAcceptance`;
 * tasks/remaining-work.md item 2.
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
import { SharedErrorCode } from '@verdery/api-contracts';
import type {
  AcceptSeasonalFactResult,
  ApiError,
  Garden as GardenResource,
  GardenSeasonalAcceptanceQueue,
} from '@verdery/api-contracts';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

const SUITE_NAME = 'seasonal acceptance routes (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** Maps an opaque bearer token directly to the credential it represents — the same fake every sibling HTTP suite uses. */
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
  /** A profile used only as the FK-satisfying actor for direct-SQL fixture rows. */
  let fixtureProfileId: string;

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

    fixtureProfileId = randomUUID();
    await db
      .insertInto('identity_access.profile')
      .values({
        id: fixtureProfileId,
        firebase_uid: `fixture-${fixtureProfileId}`,
        account_state: 'active',
      })
      .execute();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  function asQueue(response: InjectResponse): GardenSeasonalAcceptanceQueue {
    return response.json<GardenSeasonalAcceptanceQueue>();
  }

  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Seasonal Acceptance Garden' },
    });
    expect(response.statusCode).toBe(201);

    return { token, garden: response.json<GardenResource>() };
  }

  /** Grants a fresh profile `viewer` membership directly via SQL — the same shortcut `garden-context-routes.test.ts` uses to reach a non-owner role without the invitation flow. */
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

  /** A current georeference at `[longitude, latitude]` — what the garden's hemisphere is derived from. */
  async function insertGeoreference(
    gardenId: string,
    longitude: number,
    latitude: number,
  ): Promise<void> {
    const coordinateSpaceId = randomUUID();
    await db
      .insertInto('gardens_mapping.coordinate_space')
      .values({
        id: coordinateSpaceId,
        garden_id: gardenId,
        origin_description: 'south-west fence corner',
      })
      .execute();
    await sql`
      INSERT INTO gardens_mapping.georeference
        (id, garden_id, coordinate_space_id, local_anchor, geographic_anchor,
         provenance, method, created_by_profile_id)
      VALUES
        (${randomUUID()}, ${gardenId}, ${coordinateSpaceId},
         ST_SetSRID(ST_MakePoint(0, 0), 0),
         ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
         'userMeasurement', 'test-fixture', ${fixtureProfileId})
    `.execute(db);
  }

  /**
   * `randomUUID()` — a UUID **v4**, matching the seed migration's own
   * `gen_random_uuid()`. This id is embedded in
   * `AddPlantRequest.taxonomyReferenceId`, so a v7 id here would hide the
   * fact that the plant transport used to reject every real catalog taxon.
   */
  async function insertTaxonomyReference(scientificName: string): Promise<string> {
    const id = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id,
        scientific_name: scientificName,
        common_name: 'Garden pea',
        source: 'system_catalog',
        family: 'Fabaceae',
        genus: 'Pisum',
      })
      .execute();
    return id;
  }

  /**
   * `randomUUID()` deliberately — a UUID **v4**, exactly what the seed
   * migration's own `gen_random_uuid()` produces. Seeding a v7 id here
   * would have made this suite pass against a transport that rejects every
   * real seeded fact with `400`.
   */
  async function insertSeasonalFact(taxonomyReferenceId: string): Promise<string> {
    const factId = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_seasonal_fact')
      .values({
        id: factId,
        taxonomy_reference_id: taxonomyReferenceId,
        hemisphere: 'northern',
        sow_indoors_start_month: 3,
        sow_indoors_end_month: 4,
        harvest_start_month: 6,
        harvest_end_month: 8,
        authoring_method: 'human_authored',
        review_status: 'awaiting_horticultural_review',
      })
      .execute();
    return factId;
  }

  /** A garden that grows one taxon whose northern-hemisphere timing nobody has decided about yet. */
  async function gardenWithUndecidedTiming(): Promise<{
    token: string;
    gardenId: string;
    factId: string;
  }> {
    const { token, garden } = await createGardenAsOwner();
    await insertGeoreference(garden.id, 4.3, 52.1);
    const taxonomyReferenceId = await insertTaxonomyReference(`Pisum sativum ${randomUUID()}`);
    const factId = await insertSeasonalFact(taxonomyReferenceId);

    const created = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/plants`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { displayName: 'Peas', groupingKind: 'individual', taxonomyReferenceId },
    });
    expect(created.statusCode).toBe(201);

    return { token, gardenId: garden.id, factId };
  }

  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${generateUuidV7()}/seasonal-facts/awaiting-acceptance`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('offers the taxon by name with its months nested as timing, so what is accepted is what is read', async () => {
    const { token, gardenId, factId } = await gardenWithUndecidedTiming();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${gardenId}/seasonal-facts/awaiting-acceptance`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    const queue = asQueue(response);
    expect(queue.hemisphereKnown).toBe(true);
    expect(queue.items).toHaveLength(1);

    const [item] = queue.items;
    expect(item?.id).toBe(factId);
    expect(item?.scientificName).toMatch(/^Pisum sativum/);
    expect(item?.commonName).toBe('Garden pea');
    expect(item?.hemisphere).toBe('northern');
    // Nested, and complete: every window the contract declares is present,
    // with an unconfigured one honestly null rather than omitted.
    expect(item?.timing.sowIndoorsStartMonth).toBe(3);
    expect(item?.timing.harvestEndMonth).toBe(8);
    expect(item?.timing.transplantStartMonth).toBeNull();
    expect(item?.reviewStatus).toBe('awaiting_horticultural_review');
    // Absent, never null: the fact's own discriminated union does not carry
    // these unless its status says it does.
    expect(item).not.toHaveProperty('reviewedBy');
    expect(item).not.toHaveProperty('sourceCitation');
  });

  it('reports an unlocated garden as hemisphereKnown false rather than an empty backlog', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/seasonal-facts/awaiting-acceptance`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    const queue = asQueue(response);
    expect(queue.hemisphereKnown).toBe(false);
    expect(queue.items).toEqual([]);
  });

  it('accepts one taxon, drops it from the queue, and treats a repeat as the same decision', async () => {
    const { token, gardenId, factId } = await gardenWithUndecidedTiming();

    const accepted = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/seasonal-facts/${factId}/accept`,
      headers: bearer(token),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<AcceptSeasonalFactResult>().outcome).toBe('accepted');

    const afterAccept = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${gardenId}/seasonal-facts/awaiting-acceptance`,
      headers: bearer(token),
    });
    expect(asQueue(afterAccept).items).toEqual([]);

    // A retried or double-submitted accept is one decision recorded once,
    // never an error.
    const repeat = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/seasonal-facts/${factId}/accept`,
      headers: bearer(token),
    });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json<AcceptSeasonalFactResult>().outcome).toBe('accepted');
  });

  it('answers a garden with no location with hemisphereUnknown rather than pretending to accept', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${garden.id}/seasonal-facts/${randomUUID()}/accept`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AcceptSeasonalFactResult>().outcome).toBe('hemisphereUnknown');
  });

  it('answers an unknown fact with notAcceptableHere, telling a probe nothing about which ids exist', async () => {
    const { token, gardenId } = await gardenWithUndecidedTiming();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/seasonal-facts/${randomUUID()}/accept`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<AcceptSeasonalFactResult>().outcome).toBe('notAcceptableHere');
  });

  it('refuses a viewer both the queue and the accept with 403 — this surface exists to be acted on', async () => {
    const { gardenId, factId } = await gardenWithUndecidedTiming();
    const viewerToken = await addViewerMembership(gardenId);

    const queue = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${gardenId}/seasonal-facts/awaiting-acceptance`,
      headers: bearer(viewerToken),
    });
    expect(queue.statusCode).toBe(403);
    expect(queue.json<ApiError>().error.code).toBe(SharedErrorCode.Forbidden);

    const accept = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/seasonal-facts/${factId}/accept`,
      headers: bearer(viewerToken),
    });
    expect(accept.statusCode).toBe(403);
  });

  it('rejects a non-UUID fact id with 400 before any authorization work', async () => {
    const { token, gardenId } = await gardenWithUndecidedTiming();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/seasonal-facts/not-a-uuid/accept`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(400);
  });
});
