/**
 * Full-stack integration tests for P7-ASYNC-01's scheduled recommendation
 * sweep against real PostgreSQL: the real cross-schema eligibility source,
 * the real `EvaluateGardenRecommendations` (advisory lock, launch catalog,
 * outbox emission), the real expiry phase, and the real recommendation
 * tables.
 *
 * The duplicate-safety core of the work package's acceptance evidence,
 * end to end through the scheduled path: a duplicated trigger writes
 * nothing, concurrent sweeps cannot double-generate, and the outbox event
 * commits exactly once per created candidate.
 */

import { randomUUID } from 'node:crypto';
import { RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE } from '@verdery/api-contracts';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import { KyselyGeoreferenceRepository } from '../../src/modules/gardens-mapping/persistence/kysely-georeference-repository.js';
import { SteppingClock } from '../../src/modules/integrations/application/integrations-test-doubles.js';
import {
  GetGardenPrecipitation,
  GetGardenWeather,
  KyselyWeatherRecordRepository,
} from '../../src/modules/integrations/public.js';
import {
  EvaluateGardenRecommendations,
  KyselyEvaluationGardenSource,
  KyselyTasksRecommendationsUnitOfWork,
  RunRecommendationEvaluationSweep,
  createLaunchRuleCatalog,
} from '../../src/modules/tasks-recommendations/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'recommendation evaluation sweep integration';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

const START = new Date('2026-07-25T09:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FRESHNESS = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let profileId: string;

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

    profileId = randomUUID();
    await db
      .insertInto('identity_access.profile')
      .values({ id: profileId, firebase_uid: `firebase-${profileId}`, account_state: 'active' })
      .execute();
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  async function insertGarden(lifecycleState: 'active' | 'archived' = 'active'): Promise<string> {
    const gardenId = randomUUID();
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name: 'Sweep garden',
        lifecycle_state: lifecycleState,
        created_by_profile_id: profileId,
      })
      .execute();
    return gardenId;
  }

  async function insertPlant(
    gardenId: string,
    lifecycleStage: string,
    status = 'active',
  ): Promise<string> {
    const plantId = randomUUID();
    await db
      .insertInto('plants_inventory.plant')
      .values({
        id: plantId,
        garden_id: gardenId,
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        display_name: 'Sweep plant',
        taxonomy_reference_id: null,
        variety_label: null,
        accepted_identification_id: null,
        acquisition_date: null,
        acquisition_date_type: null,
        quantity: null,
        lifecycle_stage: lifecycleStage,
        status,
        condition_note: null,
        care_guidance_note: null,
        created_by_profile_id: profileId,
        created_at: new Date(START.getTime() - 5 * DAY_MS),
        updated_at: new Date(START.getTime() - 5 * DAY_MS),
      })
      .execute();
    return plantId;
  }

  /**
   * Isolates each test's eligible set — gardens are suite-shared state
   * otherwise. One transaction, deliberately: candidate ↔ evidence form a
   * reference cycle (`primary_evidence_id`'s composite FK is DEFERRABLE
   * INITIALLY DEFERRED, checked at COMMIT), so both sides must be gone
   * before any commit sees the intermediate state.
   */
  async function deleteAllGardens(): Promise<void> {
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('platform.outbox_event').execute();
      await trx.deleteFrom('tasks_recommendations.recommendation_priority_factor').execute();
      await trx.deleteFrom('tasks_recommendations.recommendation_evidence').execute();
      await trx.deleteFrom('tasks_recommendations.recommendation_candidate').execute();
      await trx.deleteFrom('plants_inventory.plant').execute();
      await trx.deleteFrom('integrations.weather_record').execute();
      await trx.deleteFrom('gardens_mapping.garden').execute();
    });
  }

  function makeSweep(clock: SteppingClock): RunRecommendationEvaluationSweep {
    const unitOfWork = new KyselyTasksRecommendationsUnitOfWork(db, clock);
    const evaluate = new EvaluateGardenRecommendations(
      unitOfWork,
      createLaunchRuleCatalog(),
      new GetGardenWeather(new KyselyWeatherRecordRepository(db), FRESHNESS, clock),
      new GetGardenPrecipitation(new KyselyWeatherRecordRepository(db)),
      new KyselyGeoreferenceRepository(db),
      clock,
    );
    return new RunRecommendationEvaluationSweep(
      new KyselyEvaluationGardenSource(db),
      evaluate,
      unitOfWork,
      // The kill-switch-off reality of every environment; the AI phase
      // has its own integration suite (recommendation-ai-explanation).
      null,
      clock,
    );
  }

  async function candidateRows(): Promise<{ id: string; garden_id: string; state: string }[]> {
    return db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .select(['id', 'garden_id', 'state'])
      .orderBy('created_at')
      .execute();
  }

  it('evaluates exactly the eligible gardens, emits one committed outbox event per created candidate, and a duplicated trigger is a no-op', async () => {
    await deleteAllGardens();
    const eligible = await insertGarden('active');
    await insertPlant(eligible, 'ready_to_harvest');
    const archived = await insertGarden('archived');
    await insertPlant(archived, 'ready_to_harvest');
    const plantless = await insertGarden('active');
    const inactiveOnly = await insertGarden('active');
    await insertPlant(inactiveOnly, 'ready_to_harvest', 'removed');

    const clock = new SteppingClock(START);
    const sweep = makeSweep(clock);

    const first = await sweep.execute();
    expect(first).toEqual({
      gardensEvaluated: 1,
      candidatesCreated: 1,
      candidatesSuperseded: 0,
      candidatesExpired: 0,
      lostRaces: 0,
      // P7-ANALYTICS-01: both weather-required rules (watering observation,
      // frost forecast) skip on the no-weather-record reality of this
      // suite; P9D-SEASON-RULES-01's three seasonal rules skip too, on the
      // never-georeferenced (hemisphere-unknown) reality of the same
      // eligible garden — all five are `factMissing`/`weatherMissing`
      // typed skips, never silence.
      ruleSkips: { factMissing: 3, weatherMissing: 2 },
      // P7-AI-01: null embellisher — the kill-switch-off reality.
      embellishment: null,
    });

    const rows = await candidateRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ garden_id: eligible, state: 'eligible' });
    expect(
      rows.filter((row) => [archived, plantless, inactiveOnly].includes(row.garden_id)),
    ).toEqual([]);

    // The outbox event committed with the candidate, in the same transaction.
    const events = await db
      .selectFrom('platform.outbox_event')
      .select(['event_type', 'aggregate_type', 'aggregate_id', 'payload', 'published_at'])
      .where('event_type', '=', RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE)
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregate_type: 'recommendation_candidate',
      aggregate_id: rows[0]?.id,
      published_at: null,
    });
    expect(events[0]?.payload).toMatchObject({
      candidateId: rows[0]?.id,
      gardenId: eligible,
      ruleKey: 'lifecycle.harvest-readiness-check',
      ruleVersion: 1,
      targetKind: 'plant',
    });

    // Duplicate-safe scheduled runs: the retried trigger re-evaluates over
    // unchanged facts, suppresses on the live candidate, and writes nothing
    // — no second candidate, no second event.
    const second = await sweep.execute();
    expect(second).toEqual({
      gardensEvaluated: 1,
      candidatesCreated: 0,
      candidatesSuperseded: 0,
      candidatesExpired: 0,
      lostRaces: 0,
      ruleSkips: { factMissing: 3, weatherMissing: 2 },
      embellishment: null,
    });
    expect(await candidateRows()).toHaveLength(1);
    const eventCount = await db
      .selectFrom('platform.outbox_event')
      .select(db.fn.countAll().as('count'))
      .where('event_type', '=', RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE)
      .executeTakeFirstOrThrow();
    expect(Number(eventCount.count)).toBe(1);
  });

  it('carries STALE weather honestly through the whole scheduled path: labeled candidate, elevated-risk skip, typed counter', async () => {
    // P7-QA-01 stale-weather end-to-end: the per-rule postures the fixtures
    // pin at the engine level (`useLabeledStale` for the watering rule,
    // `skip` for the elevated-risk frost rule) proven through the REAL
    // sweep against real rows — the stale label must survive into the
    // persisted evidence and factor rows Today re-reads, and the frost
    // skip must surface as the sweep summary's typed `weatherStale` count.
    await deleteAllGardens();
    const gardenId = await insertGarden('active');
    await insertPlant(gardenId, 'growing');

    const records = new KyselyWeatherRecordRepository(db);
    const weatherBase = {
      gardenId,
      providerKey: 'fake-provider-a',
      location: { latitude: 52.1, longitude: 4.3 },
      quality: { confidence: null, label: null },
      licenseNote: 'seed license',
      attributionText: null,
    };
    // Fetched two hours before START — past the one-hour observation
    // freshness window, so the read classifies it stale.
    const staleObservationId = randomUUID();
    const observationFetchedAt = new Date(START.getTime() - 2 * HOUR_MS);
    // Fetched seven hours before START — past the six-hour forecast window
    // — about a freezing moment still ahead of the evaluation instant.
    const forecastFetchedAt = new Date(START.getTime() - 7 * HOUR_MS);
    await records.insertMany([
      {
        ...weatherBase,
        id: staleObservationId,
        kind: 'observation',
        effectiveAt: observationFetchedAt,
        fetchedAt: observationFetchedAt,
        createdAt: observationFetchedAt,
        measurements: {
          temperatureCelsius: 27,
          precipitationMm: 0,
          windSpeedMps: null,
          humidityPercent: null,
        },
        precipitationIntervalSeconds: null,
        sourceUnits: {
          temperature: 'celsius',
          precipitation: 'millimetre',
          windSpeed: null,
          humidity: null,
        },
      },
      {
        ...weatherBase,
        id: randomUUID(),
        kind: 'forecast',
        effectiveAt: new Date(START.getTime() + 6 * HOUR_MS),
        fetchedAt: forecastFetchedAt,
        createdAt: forecastFetchedAt,
        measurements: {
          temperatureCelsius: -2,
          precipitationMm: null,
          windSpeedMps: null,
          humidityPercent: null,
        },
        precipitationIntervalSeconds: null,
        sourceUnits: {
          temperature: 'celsius',
          precipitation: null,
          windSpeed: null,
          humidity: null,
        },
      },
    ]);

    const summary = await makeSweep(new SteppingClock(START)).execute();
    expect(summary).toEqual({
      gardensEvaluated: 1,
      // The watering rule's declared posture is `useLabeledStale`: it fires.
      candidatesCreated: 1,
      candidatesSuperseded: 0,
      candidatesExpired: 0,
      lostRaces: 0,
      // The elevated-risk frost rule's declared posture is `skip`: a stale
      // forecast produces nothing, and the skip is a typed counter.
      ruleSkips: { factMissing: 3, weatherStale: 1 },
      embellishment: null,
    });

    const rows = await candidateRows();
    expect(rows).toHaveLength(1);
    const candidateId = rows[0]?.id ?? '';

    // The stale label is durable in the evidence row, pinned to the exact
    // stored record the reading came from.
    const weatherEvidence = await db
      .selectFrom('tasks_recommendations.recommendation_evidence')
      .select(['source_weather_record_id', 'fact_value'])
      .where('candidate_id', '=', candidateId)
      .where('fact_key', '=', 'weather.dry_spell_observation')
      .executeTakeFirstOrThrow();
    expect(weatherEvidence.source_weather_record_id).toBe(staleObservationId);
    expect(weatherEvidence.fact_value).toMatchObject({
      freshness: 'stale',
      temperatureCelsius: 27,
    });

    // ...and in the confidence factor: the reduced stale-weather
    // contribution with the label in its basis, exactly what Today re-reads.
    const confidenceFactor = await db
      .selectFrom('tasks_recommendations.recommendation_priority_factor')
      .select(['factor_value'])
      .where('candidate_id', '=', candidateId)
      .where('factor_kind', '=', 'confidence')
      .executeTakeFirstOrThrow();
    expect(confidenceFactor.factor_value).toEqual({
      contribution: 8,
      basis: { weatherFreshness: 'stale' },
    });
  });

  it('concurrent sweep invocations serialize on the per-garden advisory lock — no duplicate candidates, no duplicate events', async () => {
    await deleteAllGardens();
    const gardenId = await insertGarden('active');
    await insertPlant(gardenId, 'ready_to_harvest');
    const clock = new SteppingClock(START);

    const results = await Promise.all([makeSweep(clock).execute(), makeSweep(clock).execute()]);

    const createdCounts = results.map((result) => result.candidatesCreated).sort();
    expect(createdCounts).toEqual([0, 1]);
    expect(await candidateRows()).toHaveLength(1);
    const eventCount = await db
      .selectFrom('platform.outbox_event')
      .select(db.fn.countAll().as('count'))
      .where('event_type', '=', RECOMMENDATION_CANDIDATE_CREATED_EVENT_TYPE)
      .executeTakeFirstOrThrow();
    expect(Number(eventCount.count)).toBe(1);
  });

  it('expires a passed-window candidate whose rule no longer fires, while a still-firing rule supersedes instead — in one run', async () => {
    await deleteAllGardens();
    // Garden A: harvest candidate whose plant later leaves the ready stage —
    // on re-sweep past the window, nothing re-fires, so the sweep EXPIRES it.
    const gardenA = await insertGarden('active');
    const plantA = await insertPlant(gardenA, 'ready_to_harvest');
    // Garden B: the plant stays ready — on re-sweep past the window the rule
    // re-fires and SUPERSEDES the stale candidate; expiry never touches it.
    const gardenB = await insertGarden('active');
    await insertPlant(gardenB, 'ready_to_harvest');

    const clock = new SteppingClock(START);
    const first = await makeSweep(clock).execute();
    expect(first.candidatesCreated).toBe(2);

    await db
      .updateTable('plants_inventory.plant')
      .set({ lifecycle_stage: 'growing' })
      .where('id', '=', plantA)
      .execute();

    // Eight days on: both candidates' 5-day validity windows have passed.
    clock.advanceMs(8 * DAY_MS);
    const second = await makeSweep(clock).execute();

    expect(second).toMatchObject({
      candidatesCreated: 1, // garden B's successor
      candidatesSuperseded: 1, // garden B's stale candidate
      candidatesExpired: 1, // garden A's orphaned candidate
    });

    const rows = await candidateRows();
    const byGarden = (gardenId: string) => rows.filter((row) => row.garden_id === gardenId);
    expect(byGarden(gardenA).map((row) => row.state)).toEqual(['expired']);
    expect(
      byGarden(gardenB)
        .map((row) => row.state)
        .sort(),
    ).toEqual(['eligible', 'superseded']);

    // Third run: nothing left to expire, nothing to regenerate for A, B's
    // successor is live — the sweep has converged.
    const third = await makeSweep(clock).execute();
    expect(third).toMatchObject({
      candidatesCreated: 0,
      candidatesSuperseded: 0,
      candidatesExpired: 0,
    });
  });
});
