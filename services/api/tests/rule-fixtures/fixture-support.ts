/**
 * Shared vocabulary for the reviewable rule-fixture suite — see README.md
 * in this directory for what these fixtures are and how a horticultural
 * reviewer reads them.
 *
 * Every fixture is total: it pins the ENTIRE evaluation plan (every
 * decision, every planned candidate with its evidence, factors, window,
 * and rendered explanation) for one constructed garden, and the runner
 * asserts deep equality — no partial matching, so nothing the engine does
 * escapes review.
 */

import type {
  GardenFacts,
  GardenRuleEvaluationPlan,
  PlantFact,
  PriorCandidateFact,
  PriorRecommendationState,
  RecommendationTarget,
  RuleDecision,
  RuleSkipReason,
  SuppressionReason,
  WeatherFact,
} from '../../src/modules/tasks-recommendations/public.js';

/** The evaluation instant every fixture shares. */
export const FIXTURE_NOW = new Date('2026-07-25T09:00:00Z');

export const GARDEN_ID = '019a2000-0000-7000-8000-00000000aa01';
export const PLANT_A_ID = '019a2000-0000-7000-8000-00000000aa02';
export const PLANT_B_ID = '019a2000-0000-7000-8000-00000000aa03';
export const OBSERVATION_ID = '019a2000-0000-7000-8000-00000000aa04';
export const WEATHER_OBSERVATION_ID = '019a2000-0000-7000-8000-00000000aa05';
export const WEATHER_FORECAST_ID = '019a2000-0000-7000-8000-00000000aa06';
export const PRIOR_CANDIDATE_A_ID = '019a2000-0000-7000-8000-00000000aa07';
export const PRIOR_CANDIDATE_B_ID = '019a2000-0000-7000-8000-00000000aa08';
export const TASK_A_ID = '019a2000-0000-7000-8000-00000000aa09';
export const TASK_B_ID = '019a2000-0000-7000-8000-00000000aa0a';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export interface RuleFixture {
  readonly name: string;
  /** What the horticultural reviewer should check about this scenario, in prose. */
  readonly reviewNotes: string;
  readonly facts: GardenFacts;
  readonly prior: PriorRecommendationState;
  /** The complete expected engine output — asserted with deep equality. */
  readonly expected: GardenRuleEvaluationPlan;
  /** When set: the fired rules' keys ordered by DESCENDING priority score, asserted separately. */
  readonly expectedPriorityOrder?: readonly string[];
}

export function plantTarget(plantId: string): RecommendationTarget {
  return { kind: 'plant', gardenAreaMapObjectId: null, plantId };
}

export function plantFact(overrides: Partial<PlantFact> & { plantId: string }): PlantFact {
  return {
    displayName: 'Cherry tomato',
    lifecycleStage: 'growing',
    status: 'active',
    // Five days before FIXTURE_NOW: recent enough that the observation
    // reminder stays quiet unless a fixture says otherwise.
    createdAt: new Date('2026-07-20T09:00:00Z'),
    ...overrides,
  };
}

export function gardenFacts(overrides: Partial<GardenFacts> = {}): GardenFacts {
  return {
    gardenId: GARDEN_ID,
    evaluatedAt: FIXTURE_NOW,
    plants: [],
    observations: [],
    openTasks: [],
    weatherObservation: { availability: 'missing' },
    weatherForecast: { availability: 'missing' },
    ...overrides,
  };
}

export function noPrior(): PriorRecommendationState {
  return { liveCandidates: [], latestPerRuleAndTarget: [] };
}

/** A prior candidate for PLANT_A at rule version 1, created a day before the fixture instant, every field overridable. */
export function priorCandidate(
  overrides: Partial<PriorCandidateFact> & { candidateId: string; ruleKey: string },
): PriorCandidateFact {
  return {
    ruleVersion: 1,
    state: 'generated',
    revision: 1,
    target: plantTarget(PLANT_A_ID),
    windowEnd: null,
    createdAt: new Date(FIXTURE_NOW.getTime() - DAY_MS),
    ...overrides,
  };
}

/** A current-conditions weather fact: 27 °C and 0 mm precipitation (a warm dry day) unless overridden. */
export function weatherObservationFact(
  overrides: Partial<Extract<WeatherFact, { availability: 'available' }>> = {},
): WeatherFact {
  return {
    availability: 'available',
    weatherRecordId: WEATHER_OBSERVATION_ID,
    kind: 'observation',
    freshness: 'fresh',
    effectiveAt: new Date('2026-07-25T08:30:00Z'),
    measurements: {
      temperatureCelsius: 27,
      precipitationMm: 0,
      windSpeedMps: null,
      humidityPercent: null,
    },
    ...overrides,
  };
}

/** All launch rules are version 1, so the decision helpers below fix it. */
export function fireDecision(
  ruleKey: string,
  plantId: string,
  priorityScore: number,
  supersedesCandidateId: string | null = null,
): RuleDecision {
  return {
    kind: 'fire',
    ruleKey,
    ruleVersion: 1,
    target: plantTarget(plantId),
    priorityScore,
    supersedesCandidateId,
  };
}

export function notEligibleDecision(
  ruleKey: string,
  plantId: string,
  reasonCode: string,
): RuleDecision {
  return {
    kind: 'targetNotEligible',
    ruleKey,
    ruleVersion: 1,
    target: plantTarget(plantId),
    reasonCode,
  };
}

export function ruleSkippedDecision(ruleKey: string, reason: RuleSkipReason): RuleDecision {
  return { kind: 'ruleSkipped', ruleKey, ruleVersion: 1, reason };
}

export function suppressedDecision(
  ruleKey: string,
  plantId: string,
  reason: SuppressionReason,
): RuleDecision {
  return {
    kind: 'targetSuppressed',
    ruleKey,
    ruleVersion: 1,
    target: plantTarget(plantId),
    reason,
  };
}

/** A forecast weather fact: -2 °C effective at 03:00 the following night unless overridden. */
export function weatherForecastFact(
  overrides: Partial<Extract<WeatherFact, { availability: 'available' }>> = {},
): WeatherFact {
  return {
    availability: 'available',
    weatherRecordId: WEATHER_FORECAST_ID,
    kind: 'forecast',
    freshness: 'fresh',
    effectiveAt: new Date('2026-07-26T03:00:00Z'),
    measurements: {
      temperatureCelsius: -2,
      precipitationMm: null,
      windSpeedMps: null,
      humidityPercent: null,
    },
    ...overrides,
  };
}
