import { describe, expect, it } from 'vitest';
import { InternalError } from '../../../platform/errors/application-error.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { WeatherRecord } from '../../integrations/public.js';
import type { Plant } from '../../plants-inventory/public.js';
import { buildRuleDefinition } from '../domain/rule-engine-test-support.js';
import { RuleCatalog } from '../domain/rule-catalog.js';
import { createLaunchRuleCatalog } from '../domain/rules/launch-rule-catalog.js';
import { createRuleVersion } from '../domain/rule-version.js';
import { EvaluateGardenRecommendations } from './evaluate-garden-recommendations.js';
import {
  FakeGeoreferenceRepository,
  getGardenPrecipitationOver,
  getGardenWeatherOver,
} from './recommendation-test-doubles.js';
import {
  FakeTasksRecommendationsUnitOfWork,
  buildTask,
  createTasksRecommendationsFakes,
  fixedClock,
} from './tasks-recommendations-test-doubles.js';

const GARDEN_ID = '019a1000-0000-7000-8000-000000000001';
const PLANT_ID = '019a1000-0000-7000-8000-000000000002';
const PROFILE_ID = '019a1000-0000-7000-8000-000000000003';
const NOW = new Date('2026-07-25T09:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const FRESHNESS = { observationFreshForMs: HOUR_MS, forecastFreshForMs: 6 * HOUR_MS };

function plant(overrides: Partial<Plant> = {}): Plant {
  return {
    id: PLANT_ID,
    gardenId: GARDEN_ID,
    displayName: 'Cherry tomato',
    taxonomyReferenceId: null,
    varietyLabel: null,
    gardenAreaMapObjectId: null,
    placementMapObjectId: null,
    acceptedIdentificationId: null,
    acquisitionDate: null,
    acquisitionDateType: null,
    groupingKind: 'individual',
    quantity: null,
    lifecycleStage: 'ready_to_harvest',
    status: 'active',
    conditionNote: null,
    careGuidanceNote: null,
    revision: 1,
    createdByProfileId: PROFILE_ID,
    createdAt: new Date('2026-07-20T09:00:00Z'),
    updatedAt: new Date('2026-07-20T09:00:00Z'),
    ...overrides,
  };
}

/**
 * Seven elapsed days of daily totals, all bone dry — the history
 * `watering.dry-spell-check` v2 accumulates over. Each carries the daily
 * interval, which is what keeps them summable as one series.
 */
function rainlessWeek(): WeatherRecord[] {
  return Array.from({ length: 7 }, (_unused, index) =>
    weatherObservationRecord({
      id: generateUuidV7(),
      effectiveAt: new Date(NOW.getTime() - (index + 1) * 24 * 60 * 60 * 1000),
      fetchedAt: new Date(NOW.getTime() - (index + 1) * 24 * 60 * 60 * 1000),
      measurements: {
        temperatureCelsius: null,
        precipitationMm: 0,
        windSpeedMps: null,
        humidityPercent: null,
      },
      precipitationIntervalSeconds: 24 * 60 * 60,
    }),
  );
}

function weatherObservationRecord(overrides: Partial<WeatherRecord> = {}): WeatherRecord {
  return {
    id: generateUuidV7(),
    gardenId: GARDEN_ID,
    providerKey: 'fake-provider',
    kind: 'observation',
    effectiveAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    fetchedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    location: { latitude: 52.1, longitude: 4.3 },
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
    quality: { confidence: null, label: null },
    licenseNote: 'test license',
    attributionText: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeEvaluate(options: {
  catalog?: RuleCatalog;
  fakes: ReturnType<typeof createTasksRecommendationsFakes>;
  weatherRecords?: readonly WeatherRecord[];
  georeferenceRepository?: FakeGeoreferenceRepository;
}) {
  return new EvaluateGardenRecommendations(
    new FakeTasksRecommendationsUnitOfWork(options.fakes),
    options.catalog ?? createLaunchRuleCatalog(),
    getGardenWeatherOver(options.weatherRecords ?? [], FRESHNESS, fixedClock(NOW)),
    getGardenPrecipitationOver(options.weatherRecords ?? []),
    options.georeferenceRepository ?? new FakeGeoreferenceRepository(),
    fixedClock(NOW),
  );
}

describe('EvaluateGardenRecommendations', () => {
  it('serializes on the garden evaluation lock and registers every catalog version idempotently', async () => {
    const fakes = createTasksRecommendationsFakes();
    const evaluate = makeEvaluate({ fakes });

    await evaluate.execute({ gardenId: GARDEN_ID });
    await evaluate.execute({ gardenId: GARDEN_ID });

    expect(fakes.recommendationCandidates.lockedGardenIds).toEqual([GARDEN_ID, GARDEN_ID]);
    const registered = [...fakes.ruleVersions.rows.values()].map(
      (row) => `${row.ruleKey}@${String(row.version)}`,
    );
    // Every SHIPPED version is registered, not only the active ones: a
    // stored candidate pins the version that produced it, so the row it
    // references has to exist even after a newer version supersedes it.
    expect(registered.sort()).toEqual([
      'lifecycle.harvest-readiness-check@1',
      'observation.routine-check-reminder@1',
      'rotation.crop-rotation-caution@1',
      'seasonal.sowing-window-check@1',
      'succession.replanting-reminder@1',
      'watering.dry-spell-check@1',
      'watering.dry-spell-check@2',
      'weather.frost-watch@1',
    ]);
  });

  it('persists a fired candidate whole: evidence referencing the consulted plant, factors with contributions, rendered explanation', async () => {
    const fakes = createTasksRecommendationsFakes({
      plants: new Map([[PLANT_ID, plant()]]),
    });
    const result = await makeEvaluate({ fakes }).execute({ gardenId: GARDEN_ID });

    // No weather configured: both weather rules skip with the typed
    // missing reason; the observation reminder finds the plant recently
    // added; only the harvest rule fires.
    expect(result.createdCandidates).toHaveLength(1);
    const created = result.createdCandidates[0];
    expect(created).toMatchObject({
      ruleKey: 'lifecycle.harvest-readiness-check',
      ruleVersion: 1,
      target: { kind: 'plant', gardenAreaMapObjectId: null, plantId: PLANT_ID },
      urgency: 'high',
      priorityScore: 75,
      supersedesCandidateId: null,
      supersededLivePrior: false,
    });
    expect(created?.explanation).toBe(
      'Cherry tomato is marked ready to harvest. Check ripeness and harvest what is ready ' +
        'before the window passes.',
    );

    const candidateId = created?.candidateId ?? '';
    const stored = fakes.recommendationCandidates.candidates.get(candidateId);
    // P7-BE-01: candidates persist already-`eligible` (the engine's own
    // filters passed by planning time) with the rendered explanation
    // stored — the Today surface reads exactly this shape.
    expect(stored).toMatchObject({
      state: 'eligible',
      revision: 2,
      safetyTier: 'ordinary_care',
      explanation:
        'Cherry tomato is marked ready to harvest. Check ripeness and harvest what is ready ' +
        'before the window passes.',
    });
    const evidence = fakes.recommendationCandidates.evidenceByCandidate.get(candidateId);
    expect(evidence).toHaveLength(1);
    expect(evidence?.[0]).toMatchObject({
      kind: 'lifecycle_stage',
      sourcePlantId: PLANT_ID,
      factKey: 'plant.lifecycle_stage',
      factValue: { lifecycleStage: 'ready_to_harvest' },
    });
    expect(stored?.primaryEvidenceId).toBe(evidence?.[0]?.id);
    const factors = fakes.recommendationCandidates.factorsByCandidate.get(candidateId);
    expect(factors?.map((factor) => factor.factorKind).sort()).toEqual([
      'confidence',
      'plant_impact',
      'urgency_window',
    ]);

    // P7-ASYNC-01: one `recommendation.candidate_created` outbox event,
    // appended in the same transaction as the candidate insert.
    expect(fakes.outbox.events).toHaveLength(1);
    expect(fakes.outbox.events[0]).toMatchObject({
      eventType: 'recommendation.candidate_created',
      aggregateType: 'recommendation_candidate',
      aggregateId: candidateId,
      payload: expect.objectContaining({
        candidateId,
        gardenId: GARDEN_ID,
        ruleKey: 'lifecycle.harvest-readiness-check',
        ruleVersion: 1,
        targetKind: 'plant',
        targetPlantId: PLANT_ID,
        urgency: 'high',
        priorityScore: 75,
        supersedesCandidateId: null,
      }) as unknown,
    });

    // Scoped to weather-typed skips specifically: `result.decisions` also
    // carries the three P9D-SEASON-RULES-01 seasonal rules' own
    // `factMissing` (hemisphere-unknown) skips, not this test's concern.
    const weatherSkips = result.decisions.filter(
      (decision) =>
        decision.kind === 'ruleSkipped' &&
        (decision.reason.kind === 'weatherMissing' || decision.reason.kind === 'weatherStale'),
    );
    expect(weatherSkips).toEqual([
      expect.objectContaining({
        ruleKey: 'watering.dry-spell-check',
        reason: { kind: 'weatherMissing', requiredKind: 'observation' },
      }),
      expect.objectContaining({
        ruleKey: 'weather.frost-watch',
        reason: { kind: 'weatherMissing', requiredKind: 'forecast' },
      }),
    ]);
  });

  it('is idempotent per evaluation window: the second run suppresses on the live candidate and writes nothing', async () => {
    const fakes = createTasksRecommendationsFakes({
      plants: new Map([[PLANT_ID, plant()]]),
    });
    const evaluate = makeEvaluate({ fakes });

    const first = await evaluate.execute({ gardenId: GARDEN_ID });
    const second = await evaluate.execute({ gardenId: GARDEN_ID });

    expect(first.createdCandidates).toHaveLength(1);
    expect(second.createdCandidates).toEqual([]);
    expect(fakes.recommendationCandidates.candidates.size).toBe(1);
    // The suppressed re-run appended no second outbox event either.
    expect(fakes.outbox.events).toHaveLength(1);
    expect(second.decisions).toContainEqual(
      expect.objectContaining({
        kind: 'targetSuppressed',
        ruleKey: 'lifecycle.harvest-readiness-check',
        reason: expect.objectContaining({ kind: 'liveCandidateExists' }) as unknown,
      }),
    );
  });

  it('feeds weather facts to the engine: a warm reading over a rainless week fires the watering rule with the weather record pinned as evidence', async () => {
    const record = weatherObservationRecord();
    const fakes = createTasksRecommendationsFakes({
      plants: new Map([[PLANT_ID, plant({ lifecycleStage: 'growing' })]]),
    });
    // v2 decides on ACCUMULATION, so a single latest reading is no longer
    // enough to fire it — a week of elapsed daily totals is what says "dry".
    const result = await makeEvaluate({
      fakes,
      weatherRecords: [record, ...rainlessWeek()],
    }).execute({
      gardenId: GARDEN_ID,
    });

    const watering = result.createdCandidates.find(
      (candidate) => candidate.ruleKey === 'watering.dry-spell-check',
    );
    expect(watering).toBeDefined();
    const evidence = fakes.recommendationCandidates.evidenceByCandidate.get(
      watering?.candidateId ?? '',
    );
    expect(evidence).toContainEqual(
      expect.objectContaining({ kind: 'weather', sourceWeatherRecordId: record.id }),
    );
  });

  it('suppresses a rule whose open suggested task originates from its own prior candidate', async () => {
    const fakes = createTasksRecommendationsFakes({
      plants: new Map([[PLANT_ID, plant()]]),
    });
    const evaluate = makeEvaluate({ fakes });
    const first = await evaluate.execute({ gardenId: GARDEN_ID });
    const candidateId = first.createdCandidates[0]?.candidateId ?? '';

    // P7-BE-01's conversion, simulated: the candidate becomes an open
    // suggested task and is itself resolved.
    const stored = fakes.recommendationCandidates.candidates.get(candidateId);
    if (stored === undefined) {
      throw new Error('expected a stored candidate');
    }
    fakes.recommendationCandidates.candidates.set(candidateId, {
      ...stored,
      state: 'completed',
      revision: stored.revision + 1,
    });
    fakes.tasks.tasks.set('task-1', {
      ...buildTask({ id: 'task-1', gardenId: GARDEN_ID }),
      status: 'suggested',
      source: 'suggested',
      targetKind: 'plant',
      targetPlantId: PLANT_ID,
      originRecommendationId: candidateId,
    });

    const rerun = await evaluate.execute({ gardenId: GARDEN_ID });
    expect(rerun.createdCandidates).toEqual([]);
    expect(rerun.decisions).toContainEqual(
      expect.objectContaining({
        kind: 'targetSuppressed',
        ruleKey: 'lifecycle.harvest-readiness-check',
        reason: { kind: 'openTaskExists', taskId: 'task-1' },
      }),
    );
  });

  it('supersedes a stale live candidate transactionally: prior transitions to superseded, the new one references it', async () => {
    const fakes = createTasksRecommendationsFakes();
    const v1 = buildRuleDefinition();
    const evaluateV1 = makeEvaluate({ fakes, catalog: new RuleCatalog([v1]) });
    const first = await evaluateV1.execute({ gardenId: GARDEN_ID });
    const priorId = first.createdCandidates[0]?.candidateId ?? '';
    expect(priorId).not.toBe('');

    const v2 = buildRuleDefinition({ version: 2 });
    const evaluateV2 = makeEvaluate({ fakes, catalog: new RuleCatalog([v1, v2]) });
    const second = await evaluateV2.execute({ gardenId: GARDEN_ID });

    expect(second.createdCandidates).toHaveLength(1);
    expect(second.createdCandidates[0]?.supersedesCandidateId).toBe(priorId);
    const prior = fakes.recommendationCandidates.candidates.get(priorId);
    expect(prior?.state).toBe('superseded');
    const successor = fakes.recommendationCandidates.candidates.get(
      second.createdCandidates[0]?.candidateId ?? '',
    );
    expect(successor?.supersedesCandidateId).toBe(priorId);
  });

  it('refuses to run when a registered rule version’s stored tier disagrees with the catalog — content drift without a version bump', async () => {
    const fakes = createTasksRecommendationsFakes();
    await fakes.ruleVersions.ensure(
      createRuleVersion({
        id: generateUuidV7(),
        rawRuleKey: 'test.rule',
        rawVersion: 1,
        safetyTier: 'elevated_risk',
        now: NOW,
      }),
    );
    const evaluate = makeEvaluate({
      fakes,
      catalog: new RuleCatalog([buildRuleDefinition()]),
    });

    await expect(evaluate.execute({ gardenId: GARDEN_ID })).rejects.toBeInstanceOf(InternalError);
    expect(fakes.recommendationCandidates.candidates.size).toBe(0);
  });

  it('consults GeoreferenceRepository.findCurrentForGarden for the evaluated garden (P9D-SEASON-DATA-01 hemisphere wiring)', async () => {
    const fakes = createTasksRecommendationsFakes();
    const georeferenceRepository = new FakeGeoreferenceRepository();

    await makeEvaluate({ fakes, georeferenceRepository }).execute({ gardenId: GARDEN_ID });

    // The derivation itself (sign of geographicAnchor[1], and the null/
    // never-georeferenced case) is unit-tested directly in
    // garden-facts.test.ts against `deriveHemisphere`; this proves the one
    // thing that test cannot: that `EvaluateGardenRecommendations` actually
    // reaches this port for the garden it is evaluating, not a different
    // one and not zero times.
    expect(georeferenceRepository.calls).toEqual([GARDEN_ID]);
  });
});
