/**
 * P9-QA-01, Batch B, Matrix 9 (Season-boundary) — the equator edge case,
 * exercised through the FULL real-Postgres path, not `deriveHemisphere` in
 * isolation.
 *
 * `garden-facts.test.ts` already unit-tests `deriveHemisphere([0, 0]) ===
 * 'northern'` in isolation (the documented conservative choice — see that
 * function's own header, `garden-facts.ts`). `tests/integration/
 * garden-hemisphere.test.ts` already proves hemisphere derivation end to
 * end through a REAL `KyselyGeoreferenceRepository` read for a positive
 * latitude (Amsterdam), a negative one (Sydney), and an ungeoreferenced
 * garden — but never latitude exactly `0`, and never carries the derived
 * hemisphere any further than the repository read plus the pure function.
 *
 * This suite closes both gaps at once: a garden georeferenced at EXACTLY
 * `latitude: 0` through real PostGIS storage, read back through the real
 * `KyselyGeoreferenceRepository`, and threaded through TWO real read paths
 * that consume `GardenFacts.hemisphere`/`GardenSeasonalPlan.hemisphere`:
 *
 *   1. `GetGardenSeasonalPlan` — confirms the plan's own `hemisphere` field
 *      reports `'northern'` and that a plant whose taxon carries a
 *      `horticulturally_reviewed` NORTHERN-hemisphere seasonal fact
 *      resolves to `{ status: 'reviewed' }` with the real configured
 *      window (not `noSeasonalData`, which is what a wrongly-derived
 *      `'southern'` — or a `null` — hemisphere would produce instead, since
 *      `gatherTaxonomyFacts` looks up the seasonal fact BY hemisphere).
 *   2. `EvaluateGardenRecommendations` — confirms `seasonal.sowing-window-check`
 *      ACTUALLY FIRES a recommendation candidate for this equator-derived
 *      `'northern'` garden when the plant's month falls inside the
 *      configured window, the full rule-engine claim the task names by
 *      rule key, not just a read-side resolution.
 *
 * Source: tasks/todo.md, "P9-QA-01 design decisions", Batch B, Matrix 9.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import {
  CreateGarden,
  CreateMapObject,
  GardenAuthorization,
  KyselyGardensMappingUnitOfWork,
  KyselyGeoreferenceRepository,
  KyselyMembershipRepository,
} from '../../src/modules/gardens-mapping/public.js';
import {
  GetGardenPrecipitation,
  GetGardenWeather,
  KyselyWeatherRecordRepository,
} from '../../src/modules/integrations/public.js';
import {
  AddPlant,
  KyselyBedOccupancyHistoryReader,
  KyselyPlantRepository,
  KyselyPlantsInventoryUnitOfWork,
  KyselyTaxonomyReferenceRepository,
  KyselyTaxonomySeasonalFactRepository,
} from '../../src/modules/plants-inventory/public.js';
import {
  EvaluateGardenRecommendations,
  GetGardenSeasonalPlan,
  KyselyTasksRecommendationsUnitOfWork,
  createLaunchRuleCatalog,
} from '../../src/modules/tasks-recommendations/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { Clock } from '../../src/shared/time/clock.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import type { Geometry } from '@verdery/geometry-contracts';

const SUITE_NAME = 'season-boundary sweep: equator hemisphere through the full path';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const FRESHNESS = { observationFreshForMs: 60 * 60 * 1000, forecastFreshForMs: 6 * 60 * 60 * 1000 };
// Inside the configured sow-outdoors window (June-August) — see
// `insertReviewedSowingWindow` below.
const EVALUATED_AT = new Date('2026-07-15T09:00:00Z');

const BED_POLYGON: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

function fixedClock(at: Date): Clock {
  return { now: () => at };
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let ownerId: string;
  let gardenId: string;
  let bedId: string;
  let taxonomyId: string;

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

    const clock = fixedClock(EVALUATED_AT);
    ownerId = generateUuidV7();
    await db
      .insertInto('identity_access.profile')
      .values({ id: ownerId, firebase_uid: `firebase-${ownerId}`, account_state: 'active' })
      .execute();

    const createGarden = new CreateGarden(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      clock,
    );
    const garden = await createGarden.execute(ownerId, 'Equator garden', generateUuidV7());
    gardenId = garden.id;

    // Georeferenced at EXACTLY latitude 0 — real PostGIS storage, the
    // identical `ST_MakePoint` shape `garden-hemisphere.test.ts` uses for
    // its own non-zero-latitude cases.
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
         ST_SetSRID(ST_MakePoint(10, 0), 4326),
         'userMeasurement', 'test-fixture', ${ownerId})
    `.execute(db);

    const authorization = new GardenAuthorization(new KyselyMembershipRepository(db));
    const createMapObject = new CreateMapObject(
      new KyselyIdempotencyStore(db, clock),
      new KyselyGardensMappingUnitOfWork(db, clock),
      authorization,
      clock,
    );
    bedId = generateUuidV7();
    await createMapObject.execute(
      gardenId,
      ownerId,
      { type: 'createObject', objectId: bedId, category: 'bed', geometry: BED_POLYGON },
      generateUuidV7(),
    );

    taxonomyId = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_reference')
      .values({
        id: taxonomyId,
        scientific_name: 'Solanum lycopersicum',
        common_name: 'Tomato',
        variety_name: null,
        family: 'Solanaceae',
        genus: 'Solanum',
        source: 'system_catalog',
        created_by_profile_id: null,
      })
      .execute();

    // A `horticulturally_reviewed` NORTHERN-hemisphere seasonal fact with a
    // June-August sow-outdoors window, covering `EVALUATED_AT` (15 July).
    // If the equator's derived hemisphere ever silently became `'southern'`
    // (or stayed `null`), this row would simply never match — the taxon
    // would resolve to `noSeasonalData` (`GetGardenSeasonalPlan`) or a
    // whole-rule hemisphere skip (`seasonal.sowing-window-check`), which is
    // exactly what these tests assert did NOT happen.
    const northernFactId = randomUUID();
    await db
      .insertInto('plants_inventory.taxonomy_seasonal_fact')
      .values({
        id: northernFactId,
        taxonomy_reference_id: taxonomyId,
        hemisphere: 'northern',
        sow_outdoors_start_month: 6,
        sow_outdoors_end_month: 8,
        authoring_method: 'human_authored',
        review_status: 'horticulturally_reviewed',
        reviewed_by: 'Fixture Reviewer',
        reviewed_on: '2026-01-01',
      })
      .execute();
    // The garden accepts the NORTHERN row — the gate the seasonal rules read
    // since the sign-off became a per-garden decision. Only the northern one:
    // if hemisphere derivation ever picked the southern row instead, no
    // acceptance would match it and the failure stays visible rather than
    // passing by accident.
    await db
      .insertInto('plants_inventory.garden_seasonal_fact_acceptance')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        taxonomy_seasonal_fact_id: northernFactId,
        accepted_by_profile_id: ownerId,
        accepted_on: '2026-01-01',
      })
      .execute();
    // A SOUTHERN-hemisphere row for the SAME taxon, deliberately configured
    // with NO window at all — if hemisphere derivation or the lookup ever
    // picked this row instead, the plant would resolve to a real (but
    // wrong) `noSeasonalData`/`taxonomy.no_sowing_windows_configured`
    // outcome rather than the correct reviewed one, making a silent
    // mix-up visible instead of accidentally passing either way.
    await db
      .insertInto('plants_inventory.taxonomy_seasonal_fact')
      .values({
        id: randomUUID(),
        taxonomy_reference_id: taxonomyId,
        hemisphere: 'southern',
        authoring_method: 'human_authored',
        review_status: 'horticulturally_reviewed',
        reviewed_by: 'Fixture Reviewer',
        reviewed_on: '2026-01-01',
      })
      .execute();

    const plantsUnitOfWork = new KyselyPlantsInventoryUnitOfWork(db, clock);
    const addPlant = new AddPlant(
      new KyselyIdempotencyStore(db, clock),
      plantsUnitOfWork,
      authorization,
      clock,
    );
    await addPlant.execute(
      gardenId,
      ownerId,
      {
        displayName: 'Equator tomato',
        groupingKind: 'individual',
        gardenAreaMapObjectId: bedId,
        taxonomyReferenceId: taxonomyId,
      },
      generateUuidV7(),
    );
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  it('propagates latitude 0 as northern through the real georeference read, all the way into GetGardenSeasonalPlan', async () => {
    const getGardenSeasonalPlan = new GetGardenSeasonalPlan(
      new GardenAuthorization(new KyselyMembershipRepository(db)),
      new KyselyPlantRepository(db),
      new KyselyTaxonomyReferenceRepository(db),
      new KyselyTaxonomySeasonalFactRepository(db),
      new KyselyBedOccupancyHistoryReader(db),
      new KyselyGeoreferenceRepository(db),
      fixedClock(EVALUATED_AT),
    );

    const plan = await getGardenSeasonalPlan.execute(gardenId, ownerId);

    expect(plan.hemisphere).toBe('northern');
    expect(plan.plants).toHaveLength(1);
    const [plantEntry] = plan.plants;
    expect(plantEntry?.taxonomyReferenceId).toBe(taxonomyId);
    expect(plantEntry?.seasonalFact).toMatchObject({
      status: 'reviewed',
      timing: { sowOutdoorsStartMonth: 6, sowOutdoorsEndMonth: 8 },
    });
  });

  it('propagates latitude 0 as northern all the way into a REAL seasonal.sowing-window-check firing through EvaluateGardenRecommendations', async () => {
    const clock = fixedClock(EVALUATED_AT);
    const evaluate = new EvaluateGardenRecommendations(
      new KyselyTasksRecommendationsUnitOfWork(db, clock),
      createLaunchRuleCatalog(),
      new GetGardenWeather(new KyselyWeatherRecordRepository(db), FRESHNESS, clock),
      new GetGardenPrecipitation(new KyselyWeatherRecordRepository(db)),
      new KyselyGeoreferenceRepository(db),
      clock,
    );

    const result = await evaluate.execute({ gardenId });

    const sowingCandidate = result.createdCandidates.find(
      (candidate) => candidate.ruleKey === 'seasonal.sowing-window-check',
    );
    expect(sowingCandidate).toBeDefined();
    expect(sowingCandidate?.explanation).toContain('sow outdoors');

    const storedEvidence = await db
      .selectFrom('tasks_recommendations.recommendation_evidence')
      .selectAll()
      .where('candidate_id', '=', sowingCandidate?.candidateId ?? '')
      .where('fact_key', '=', 'taxonomy.sowing_window')
      .executeTakeFirstOrThrow();
    // The evidence row itself names `hemisphere: 'northern'` — the fact
    // this candidate's own firing depended on, persisted, not just implied
    // by the outcome.
    expect(storedEvidence.fact_value).toMatchObject({ hemisphere: 'northern' });
  });
});
