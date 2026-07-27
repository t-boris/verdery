/**
 * Full HTTP-level contract tests for the seasonal plan route
 * (P9D-SEASON-API-01): `GET /gardens/{gardenId}/seasonal-plan` — the real
 * Fastify application, real authentication, and a real migrated PostgreSQL
 * database, matching `garden-context-routes.test.ts`'s own harness.
 *
 * Georeference, taxonomy reference, taxonomy seasonal fact, and the
 * historical bed-occupancy journal rows are seeded with direct SQL — the
 * same "tests seed rows directly" precedent `plants-inventory/public.ts`'s
 * own header documents for `taxonomy_reference` (no application-layer write
 * path exists for it), and the same direct-`plant_revision`-row technique
 * `tests/integration/garden-hemisphere.test.ts` uses for georeference: a
 * departed occupant's exact departure instant must be precisely controlled
 * (elapsed days against real wall-clock "now"), which only a real command
 * flow re-using "now" cannot provide. The CURRENT occupant plant in every
 * scenario is created over real HTTP (`POST /gardens/{gardenId}/plants`),
 * since its own placement history needs no such control.
 *
 * Source: packages/api-contracts/openapi.yaml, tag `SeasonalPlan`;
 * tasks/todo.md, "P9D-SEASON-01 design decisions", "Stage 3 —
 * P9D-SEASON-API-01".
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
  ApiError,
  Garden as GardenResource,
  Plant as PlantResource,
  SeasonalPlanResult,
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

const DAY_MS = 24 * 60 * 60 * 1000;

function asGarden(response: InjectResponse): GardenResource {
  return response.json<GardenResource>();
}

function asPlant(response: InjectResponse): PlantResource {
  return response.json<PlantResource>();
}

function asSeasonalPlan(response: InjectResponse): SeasonalPlanResult {
  return response.json<SeasonalPlanResult>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'seasonal plan routes (HTTP)';
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
  /** A profile used only as the FK-satisfying actor for direct-SQL fixture rows — independent of any HTTP-created garden owner. */
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

  async function createGardenAsOwner(): Promise<{ token: string; garden: GardenResource }> {
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, randomUUID());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/gardens',
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: { name: 'Seasonal Plan Garden' },
    });
    expect(response.statusCode).toBe(201);

    return { token, garden: asGarden(response) };
  }

  /** A garden with a current georeference anchored at `[longitude, latitude]` — mirrors `tests/integration/garden-hemisphere.test.ts`'s own identical helper. Returns the coordinate space id, needed for placing beds in the same space. */
  async function insertGeoreference(
    gardenId: string,
    longitude: number,
    latitude: number,
  ): Promise<string> {
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
    return coordinateSpaceId;
  }

  /** An active `bed` garden_object, real enough to satisfy `Plant.gardenAreaMapObjectId`'s FK and `requirePlacementReferencesGardenObjects`'s active-object check. */
  async function insertBed(gardenId: string, coordinateSpaceId: string): Promise<string> {
    // UUIDv7, not `randomUUID()`'s v4: this id is later embedded in an HTTP
    // request body (`AddPlantRequest.gardenAreaMapObjectId`) that the
    // transport layer validates against the contract's `Uuid` pattern,
    // which requires the version-7 nibble.
    const bedId = generateUuidV7();
    await sql`
      INSERT INTO gardens_mapping.garden_object
        (id, garden_id, coordinate_space_id, category, geometry, provenance, created_by_profile_id)
      VALUES (${bedId}, ${gardenId}, ${coordinateSpaceId}, 'bed',
              ST_SetSRID(ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))'), 0),
              'manualDrawing', ${fixtureProfileId})
    `.execute(db);
    return bedId;
  }

  /** `Tests seed rows directly` (`plants-inventory/public.ts`'s own header): no application-layer write path exists for `taxonomy_reference`. `system_catalog` rows carry no `created_by_profile_id`. UUIDv7 — see `insertBed`'s own comment on why: this id is later embedded in `AddPlantRequest.taxonomyReferenceId`. */
  async function insertTaxonomyReference(family: string | null): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id,
        scientific_name: `Test taxon ${id}`,
        common_name: 'Test plant',
        source: 'system_catalog',
        family,
        genus: family === null ? null : 'Testus',
      })
      .execute();
    return id;
  }

  interface SeasonalFactOverrides {
    readonly hemisphere?: 'northern' | 'southern';
    readonly reviewStatus?: 'horticulturally_reviewed' | 'awaiting_horticultural_review';
    readonly sowIndoorsStartMonth?: number | null;
    readonly sowIndoorsEndMonth?: number | null;
    readonly rotationRestSeasons?: number | null;
  }

  async function insertSeasonalFact(
    taxonomyReferenceId: string,
    overrides: SeasonalFactOverrides = {},
  ): Promise<void> {
    const reviewStatus = overrides.reviewStatus ?? 'horticulturally_reviewed';
    await db
      .insertInto('plants_inventory.taxonomy_seasonal_fact')
      .values({
        id: randomUUID(),
        taxonomy_reference_id: taxonomyReferenceId,
        hemisphere: overrides.hemisphere ?? 'northern',
        sow_indoors_start_month: overrides.sowIndoorsStartMonth ?? 3,
        sow_indoors_end_month: overrides.sowIndoorsEndMonth ?? 4,
        rotation_rest_seasons: overrides.rotationRestSeasons ?? null,
        authoring_method: 'human_authored',
        review_status: reviewStatus,
        ...(reviewStatus === 'horticulturally_reviewed'
          ? { reviewed_by: 'Fixture Reviewer', reviewed_on: '2026-01-01' }
          : {}),
      })
      .execute();
  }

  async function createPlantAsOwner(
    token: string,
    gardenId: string,
    input: {
      readonly displayName: string;
      readonly taxonomyReferenceId?: string | null;
      readonly gardenAreaMapObjectId?: string | null;
    },
  ): Promise<PlantResource> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/gardens/${gardenId}/plants`,
      headers: { ...bearer(token), 'idempotency-key': generateUuidV7() },
      payload: {
        displayName: input.displayName,
        groupingKind: 'individual',
        ...(input.taxonomyReferenceId === undefined
          ? {}
          : { taxonomyReferenceId: input.taxonomyReferenceId }),
        ...(input.gardenAreaMapObjectId === undefined
          ? {}
          : { gardenAreaMapObjectId: input.gardenAreaMapObjectId }),
      },
    });
    expect(response.statusCode).toBe(201);
    return asPlant(response);
  }

  /**
   * A DEPARTED bed occupant, entirely by direct SQL: a `plant` row (kept
   * out of the CURRENT plants list by `status: 'archived'`) plus two
   * `plant_revision` rows — an arrival snapshot into `bedId` and a
   * departure snapshot into `elsewhereBedId` — with `occupiedUntil` set to
   * exactly `occupiedUntilDaysAgo` days before this call, computed in JS
   * (not SQL `now()`) so it is precise against the SAME process's clock the
   * HTTP request will read moments later. See this file's own header for
   * why this bypasses the command flow entirely.
   */
  async function insertDepartedOccupant(input: {
    readonly gardenId: string;
    readonly bedId: string;
    readonly elsewhereBedId: string;
    readonly taxonomyReferenceId: string;
    readonly occupiedFromDaysAgo: number;
    readonly occupiedUntilDaysAgo: number;
  }): Promise<void> {
    const plantId = randomUUID();
    await db
      .insertInto('plants_inventory.plant')
      .values({
        id: plantId,
        garden_id: input.gardenId,
        display_name: 'Departed occupant',
        grouping_kind: 'individual',
        lifecycle_stage: 'growing',
        status: 'archived',
        created_by_profile_id: fixtureProfileId,
      })
      .execute();

    const occupiedFrom = new Date(Date.now() - input.occupiedFromDaysAgo * DAY_MS);
    const occupiedUntil = new Date(Date.now() - input.occupiedUntilDaysAgo * DAY_MS);
    await sql`
      INSERT INTO plants_inventory.plant_revision
        (plant_id, revision, command_type, actor_profile_id, recorded_at,
         garden_area_map_object_id, taxonomy_reference_id)
      VALUES (${plantId}, 1, 'addPlant', ${fixtureProfileId}, ${occupiedFrom},
              ${input.bedId}, ${input.taxonomyReferenceId})
    `.execute(db);
    await sql`
      INSERT INTO plants_inventory.plant_revision
        (plant_id, revision, command_type, actor_profile_id, recorded_at,
         garden_area_map_object_id)
      VALUES (${plantId}, 2, 'movePlant', ${fixtureProfileId}, ${occupiedUntil},
              ${input.elsewhereBedId})
    `.execute(db);
  }

  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/gardens/does-not-matter/seasonal-plan',
    });
    expect(response.statusCode).toBe(401);
    expect(asError(response).error.code).toBe('auth.unauthenticated');
  });

  it('conceals a garden the caller has no membership on as 404', async () => {
    const { garden } = await createGardenAsOwner();
    const strangerToken = randomUUID();
    tokenVerifier.registerIdToken(strangerToken, randomUUID());

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/seasonal-plan`,
      headers: bearer(strangerToken),
    });
    expect(response.statusCode).toBe(404);
    expect(asError(response).error.code).toBe('garden.not_found');
  });

  it('reports hemisphere null and an empty plant list for a garden that was never georeferenced', async () => {
    const { token, garden } = await createGardenAsOwner();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/seasonal-plan`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    const plan = asSeasonalPlan(response);
    expect(plan.gardenId).toBe(garden.id);
    expect(plan.hemisphere).toBeNull();
    expect(plan.plants).toEqual([]);
    expect(plan.rotationStatus).toEqual([]);
  });

  it('covers a reviewed fact, an unknown taxon, and a taxon with no reviewed fact for this hemisphere, never omitting a plant', async () => {
    const { token, garden } = await createGardenAsOwner();
    await insertGeoreference(garden.id, 4.895, 52.37); // Amsterdam — northern

    const reviewedTaxonomyId = await insertTaxonomyReference('Solanaceae');
    await insertSeasonalFact(reviewedTaxonomyId, {
      sowIndoorsStartMonth: 3,
      sowIndoorsEndMonth: 4,
    });
    const southernOnlyTaxonomyId = await insertTaxonomyReference('Brassicaceae');
    await insertSeasonalFact(southernOnlyTaxonomyId, { hemisphere: 'southern' });

    const reviewedPlant = await createPlantAsOwner(token, garden.id, {
      displayName: 'Reviewed tomato',
      taxonomyReferenceId: reviewedTaxonomyId,
    });
    const wrongHemispherePlant = await createPlantAsOwner(token, garden.id, {
      displayName: 'Southern-only kale',
      taxonomyReferenceId: southernOnlyTaxonomyId,
    });
    const unknownTaxonPlant = await createPlantAsOwner(token, garden.id, {
      displayName: 'Unidentified seedling',
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/seasonal-plan`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    const plan = asSeasonalPlan(response);
    expect(plan.hemisphere).toBe('northern');
    expect(plan.plants).toHaveLength(3);
    const byId = new Map(plan.plants.map((entry) => [entry.plantId, entry]));

    expect(byId.get(reviewedPlant.id)).toMatchObject({
      taxonomyReferenceId: reviewedTaxonomyId,
      seasonalFact: {
        status: 'reviewed',
        timing: expect.objectContaining({
          sowIndoorsStartMonth: 3,
          sowIndoorsEndMonth: 4,
        }) as unknown,
      },
    });
    expect(byId.get(wrongHemispherePlant.id)).toEqual({
      plantId: wrongHemispherePlant.id,
      taxonomyReferenceId: southernOnlyTaxonomyId,
      seasonalFact: { status: 'noSeasonalData' },
    });
    expect(byId.get(unknownTaxonPlant.id)).toEqual({
      plantId: unknownTaxonPlant.id,
      taxonomyReferenceId: null,
      seasonalFact: { status: 'noSeasonalData' },
    });
  });

  it('reports both a WITHIN and a CLEAR rotation-rest-period plant, computed continuously against real elapsed time', async () => {
    const { token, garden } = await createGardenAsOwner();
    // One coordinate space per garden (`coordinate_space_garden_id_idx`):
    // reuse the one `insertGeoreference` already creates rather than
    // inserting a second one.
    const coordinateSpaceId = await insertGeoreference(garden.id, 4.895, 52.37);
    const bedWithinId = await insertBed(garden.id, coordinateSpaceId);
    const bedClearId = await insertBed(garden.id, coordinateSpaceId);
    const elsewhereBedId = await insertBed(garden.id, coordinateSpaceId);

    const withinTaxonomyId = await insertTaxonomyReference('Solanaceae');
    await insertSeasonalFact(withinTaxonomyId, { rotationRestSeasons: 2 }); // 730-day threshold
    const clearTaxonomyId = await insertTaxonomyReference('Brassicaceae');
    await insertSeasonalFact(clearTaxonomyId, { rotationRestSeasons: 1 }); // 365-day threshold

    await insertDepartedOccupant({
      gardenId: garden.id,
      bedId: bedWithinId,
      elsewhereBedId,
      taxonomyReferenceId: withinTaxonomyId,
      occupiedFromDaysAgo: 500,
      occupiedUntilDaysAgo: 100, // well inside the 730-day threshold
    });
    await insertDepartedOccupant({
      gardenId: garden.id,
      bedId: bedClearId,
      elsewhereBedId,
      taxonomyReferenceId: clearTaxonomyId,
      occupiedFromDaysAgo: 900,
      occupiedUntilDaysAgo: 400, // past the 365-day threshold
    });

    const withinPlant = await createPlantAsOwner(token, garden.id, {
      displayName: 'Current tomato',
      taxonomyReferenceId: withinTaxonomyId,
      gardenAreaMapObjectId: bedWithinId,
    });
    const clearPlant = await createPlantAsOwner(token, garden.id, {
      displayName: 'Current kale',
      taxonomyReferenceId: clearTaxonomyId,
      gardenAreaMapObjectId: bedClearId,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/gardens/${garden.id}/seasonal-plan`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(200);
    const plan = asSeasonalPlan(response);
    const byPlantId = new Map(plan.rotationStatus.map((entry) => [entry.plantId, entry]));

    const withinEntry = byPlantId.get(withinPlant.id);
    expect(withinEntry).toMatchObject({
      gardenAreaMapObjectId: bedWithinId,
      family: 'Solanaceae',
      priorFamily: 'Solanaceae',
      rotationRestSeasons: 2,
      restPeriodThresholdDays: 730,
      withinRestPeriod: true,
    });
    expect(withinEntry?.elapsedDays).toBe(100);

    const clearEntry = byPlantId.get(clearPlant.id);
    expect(clearEntry).toMatchObject({
      gardenAreaMapObjectId: bedClearId,
      family: 'Brassicaceae',
      priorFamily: 'Brassicaceae',
      rotationRestSeasons: 1,
      restPeriodThresholdDays: 365,
      withinRestPeriod: false,
    });
    expect(clearEntry?.elapsedDays).toBe(400);
  });
});
