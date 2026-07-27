/**
 * Full-stack integration tests for `EvaluateGardenRecommendations` against
 * real PostgreSQL: the real Kysely unit of work (with the transaction-
 * scoped garden advisory lock), the real launch catalog, real plant/
 * observation/task/weather rows, and the real recommendation tables with
 * their COMMIT-time evidence FK and tier CHECKs.
 *
 * Covers the persistence half of P7-RULE-01's acceptance evidence, on top
 * of the pure-engine fixture suite (`tests/rule-fixtures/`): candidates
 * land whole (evidence referencing the actual consulted rows, priority
 * factors as jsonb `{ contribution, basis }`), rule versions register
 * idempotently, re-evaluation is a no-op, supersession transitions the
 * prior row and links the new one, an origin-linked open task suppresses
 * regeneration, and concurrent evaluations of one garden cannot
 * double-generate.
 *
 * Source: implementation-plan.md work package P7-RULE-01;
 * architecture/testing-strategy.md, section "6. Backend Integration Tests".
 */

import { randomUUID } from 'node:crypto';
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
  GetGardenWeather,
  KyselyWeatherRecordRepository,
} from '../../src/modules/integrations/public.js';
import type { WeatherRecord } from '../../src/modules/integrations/public.js';
import {
  EvaluateGardenRecommendations,
  KyselyTasksRecommendationsUnitOfWork,
  createLaunchRuleCatalog,
} from '../../src/modules/tasks-recommendations/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';

const SUITE_NAME = 'recommendation engine integration';
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

  async function insertGarden(): Promise<string> {
    const gardenId = randomUUID();
    await db
      .insertInto('gardens_mapping.garden')
      .values({
        id: gardenId,
        name: 'Recommendation garden',
        lifecycle_state: 'active',
        created_by_profile_id: profileId,
      })
      .execute();
    return gardenId;
  }

  async function insertPlant(
    gardenId: string,
    lifecycleStage: string,
    displayName: string,
  ): Promise<string> {
    const plantId = randomUUID();
    await db
      .insertInto('plants_inventory.plant')
      .values({
        id: plantId,
        garden_id: gardenId,
        garden_area_map_object_id: null,
        placement_map_object_id: null,
        display_name: displayName,
        taxonomy_reference_id: null,
        variety_label: null,
        accepted_identification_id: null,
        acquisition_date: null,
        acquisition_date_type: null,
        quantity: null,
        lifecycle_stage: lifecycleStage,
        status: 'active',
        condition_note: null,
        care_guidance_note: null,
        created_by_profile_id: profileId,
        created_at: new Date(START.getTime() - 5 * DAY_MS),
        updated_at: new Date(START.getTime() - 5 * DAY_MS),
      })
      .execute();
    return plantId;
  }

  function drySpellObservationRecord(gardenId: string, fetchedAt: Date): WeatherRecord {
    return {
      id: randomUUID(),
      gardenId,
      providerKey: 'fixture-provider',
      kind: 'observation',
      effectiveAt: new Date(fetchedAt.getTime() - 5 * 60 * 1000),
      fetchedAt,
      location: { latitude: 52.1, longitude: 4.3 },
      measurements: {
        temperatureCelsius: 27,
        precipitationMm: 0,
        windSpeedMps: null,
        humidityPercent: null,
      },
      sourceUnits: {
        temperature: 'celsius',
        precipitation: 'millimetre',
        windSpeed: null,
        humidity: null,
      },
      quality: { confidence: null, label: null },
      licenseNote: 'fixture license',
      attributionText: null,
      createdAt: fetchedAt,
    };
  }

  function makeEvaluate(clock: SteppingClock): EvaluateGardenRecommendations {
    return new EvaluateGardenRecommendations(
      new KyselyTasksRecommendationsUnitOfWork(db, clock),
      createLaunchRuleCatalog(),
      new GetGardenWeather(new KyselyWeatherRecordRepository(db), FRESHNESS, clock),
      new KyselyGeoreferenceRepository(db),
      clock,
    );
  }

  it('persists fired candidates whole and re-runs as a no-op, with rule versions registered exactly once', async () => {
    const gardenId = await insertGarden();
    const plantId = await insertPlant(gardenId, 'ready_to_harvest', 'Cherry tomato');
    const clock = new SteppingClock(START);
    await new KyselyWeatherRecordRepository(db).insertMany([
      drySpellObservationRecord(gardenId, new Date(START.getTime() - 10 * 60 * 1000)),
    ]);
    const evaluate = makeEvaluate(clock);

    const first = await evaluate.execute({ gardenId });

    // The ready plant is NOT in the watering rule's active-growth stages,
    // so exactly one candidate fires: the harvest check.
    expect(first.createdCandidates.map((candidate) => candidate.ruleKey)).toEqual([
      'lifecycle.harvest-readiness-check',
    ]);
    const candidateId = first.createdCandidates[0]?.candidateId ?? '';

    const storedCandidate = await db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .selectAll()
      .where('id', '=', candidateId)
      .executeTakeFirstOrThrow();
    expect(storedCandidate).toMatchObject({
      garden_id: gardenId,
      target_kind: 'plant',
      target_plant_id: plantId,
      care_category: 'harvest',
      safety_tier: 'ordinary_care',
      // P7-BE-01: candidates land `eligible` (revision 2 — the recorded
      // generated -> eligible transition) with the rendered explanation
      // stored.
      state: 'eligible',
      revision: 2,
      urgency: 'high',
      supersedes_candidate_id: null,
      explanation:
        'Cherry tomato is marked ready to harvest. Check ripeness and harvest what is ready ' +
        'before the window passes.',
    });
    expect(storedCandidate.window_end).toEqual(new Date(START.getTime() + 5 * DAY_MS));

    const evidence = await db
      .selectFrom('tasks_recommendations.recommendation_evidence')
      .selectAll()
      .where('candidate_id', '=', candidateId)
      .execute();
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      evidence_kind: 'lifecycle_stage',
      source_plant_id: plantId,
      fact_key: 'plant.lifecycle_stage',
      fact_value: { lifecycleStage: 'ready_to_harvest' },
    });
    expect(storedCandidate.primary_evidence_id).toBe(evidence[0]?.id);

    const factors = await db
      .selectFrom('tasks_recommendations.recommendation_priority_factor')
      .select(['factor_kind', 'factor_value'])
      .where('candidate_id', '=', candidateId)
      .orderBy('factor_kind')
      .execute();
    expect(factors.map((row) => row.factor_kind)).toEqual([
      'confidence',
      'plant_impact',
      'urgency_window',
    ]);
    expect(factors[2]?.factor_value).toEqual({
      contribution: 30,
      basis: { urgency: 'high', validityWindowDays: 5 },
    });

    // Idempotent per evaluation window: the second run suppresses on the
    // live candidate and writes nothing new — same rule versions, same
    // single candidate.
    const second = await evaluate.execute({ gardenId });
    expect(second.createdCandidates).toEqual([]);
    expect(second.decisions).toContainEqual(
      expect.objectContaining({
        kind: 'targetSuppressed',
        ruleKey: 'lifecycle.harvest-readiness-check',
        reason: { kind: 'liveCandidateExists', candidateId },
      }),
    );
    const candidateCount = await db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(candidateCount.count)).toBe(1);

    const ruleVersions = await db
      .selectFrom('tasks_recommendations.rule_version')
      .select(['rule_key', 'version'])
      .orderBy('rule_key')
      .execute();
    expect(ruleVersions).toEqual([
      { rule_key: 'lifecycle.harvest-readiness-check', version: 1 },
      { rule_key: 'observation.routine-check-reminder', version: 1 },
      { rule_key: 'rotation.crop-rotation-caution', version: 1 },
      { rule_key: 'seasonal.sowing-window-check', version: 1 },
      { rule_key: 'succession.replanting-reminder', version: 1 },
      { rule_key: 'watering.dry-spell-check', version: 1 },
      { rule_key: 'weather.frost-watch', version: 1 },
    ]);
  });

  it('supersedes a live candidate whose window passed: prior row transitions, successor references it', async () => {
    const gardenId = await insertGarden();
    await insertPlant(gardenId, 'ready_to_harvest', 'Plum tree');
    const clock = new SteppingClock(START);
    const evaluate = makeEvaluate(clock);

    const first = await evaluate.execute({ gardenId });
    const priorId = first.createdCandidates[0]?.candidateId ?? '';
    expect(priorId).not.toBe('');

    // Eight days on: the 5-day validity window passed while the plant
    // stayed ready — the stale live candidate is replaced, not duplicated.
    clock.advanceMs(8 * DAY_MS);
    const second = await evaluate.execute({ gardenId });

    expect(second.createdCandidates).toHaveLength(1);
    const successorId = second.createdCandidates[0]?.candidateId ?? '';
    expect(second.createdCandidates[0]?.supersedesCandidateId).toBe(priorId);
    expect(second.createdCandidates[0]?.supersededLivePrior).toBe(true);

    const rows = await db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .select(['id', 'state', 'supersedes_candidate_id'])
      .where('garden_id', '=', gardenId)
      .orderBy('created_at')
      .execute();
    expect(rows).toEqual([
      { id: priorId, state: 'superseded', supersedes_candidate_id: null },
      { id: successorId, state: 'eligible', supersedes_candidate_id: priorId },
    ]);
  });

  it('suppresses regeneration while an open task converted from the rule’s own candidate exists', async () => {
    const gardenId = await insertGarden();
    const plantId = await insertPlant(gardenId, 'ready_to_harvest', 'Apple tree');
    const clock = new SteppingClock(START);
    const evaluate = makeEvaluate(clock);

    const first = await evaluate.execute({ gardenId });
    const candidateId = first.createdCandidates[0]?.candidateId ?? '';

    // P7-BE-01's conversion, simulated at the storage layer: the candidate
    // is presented and completed, and an open suggested task carries it as
    // origin.
    await db
      .updateTable('tasks_recommendations.recommendation_candidate')
      .set({ state: 'completed', presented_at: clock.now(), revision: 2 })
      .where('id', '=', candidateId)
      .execute();
    await db
      .insertInto('tasks_recommendations.task')
      .values({
        id: randomUUID(),
        garden_id: gardenId,
        target_kind: 'plant',
        target_garden_area_id: null,
        target_plant_id: plantId,
        title: 'Harvest the apples',
        notes: null,
        status: 'suggested',
        due_date: null,
        time_window_start: null,
        time_window_end: null,
        recurrence_rule: null,
        urgency: 'high',
        source: 'suggested',
        origin_observation_id: null,
        origin_recommendation_id: candidateId,
        created_by_profile_id: profileId,
      })
      .execute();

    // Ten days on — past the recurrence interval, so ONLY the open task
    // stands between the still-ready plant and a duplicate candidate.
    clock.advanceMs(10 * DAY_MS);
    const rerun = await evaluate.execute({ gardenId });

    // The harvest rule regenerates nothing. (The observation reminder
    // legitimately fires — the plant is 15 days unobserved by now — with
    // the open task's overlap penalty applied; that is not a duplicate.)
    expect(
      rerun.createdCandidates.filter(
        (candidate) => candidate.ruleKey === 'lifecycle.harvest-readiness-check',
      ),
    ).toEqual([]);
    expect(rerun.createdCandidates.map((candidate) => candidate.ruleKey)).toEqual([
      'observation.routine-check-reminder',
    ]);
    expect(rerun.decisions).toContainEqual(
      expect.objectContaining({
        kind: 'targetSuppressed',
        ruleKey: 'lifecycle.harvest-readiness-check',
        reason: expect.objectContaining({ kind: 'openTaskExists' }) as unknown,
      }),
    );
  });

  it('serializes concurrent evaluations of one garden — no duplicate candidates under a real race', async () => {
    const gardenId = await insertGarden();
    await insertPlant(gardenId, 'ready_to_harvest', 'Pear tree');
    const clock = new SteppingClock(START);

    const results = await Promise.all([
      makeEvaluate(clock).execute({ gardenId }),
      makeEvaluate(clock).execute({ gardenId }),
    ]);

    const createdCounts = results.map((result) => result.createdCandidates.length).sort();
    expect(createdCounts).toEqual([0, 1]);
    const candidateCount = await db
      .selectFrom('tasks_recommendations.recommendation_candidate')
      .select(db.fn.countAll().as('count'))
      .where('garden_id', '=', gardenId)
      .executeTakeFirstOrThrow();
    expect(Number(candidateCount.count)).toBe(1);
  });
});
