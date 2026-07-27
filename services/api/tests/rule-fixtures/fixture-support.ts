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
  PriorBedOccupantFact,
  PriorCandidateFact,
  PriorRecommendationState,
  RecommendationTarget,
  RuleDecision,
  RuleSkipReason,
  SuppressionReason,
  TaxonomyFact,
  WeatherFact,
} from '../../src/modules/tasks-recommendations/public.js';
import type {
  TaxonomySeasonalFact,
  TaxonomySeasonalTiming,
} from '../../src/modules/plants-inventory/public.js';

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
/** P9D-SEASON-RULES-01: a taxon and a bed placement the seasonal rules' own fixtures share. */
export const TAXONOMY_A_ID = '019a2000-0000-7000-8000-00000000aa0b';
export const TAXONOMY_B_ID = '019a2000-0000-7000-8000-00000000aa0c';
export const GARDEN_AREA_A_ID = '019a2000-0000-7000-8000-00000000aa0d';
export const SEASONAL_FACT_A_ID = '019a2000-0000-7000-8000-00000000aa0e';

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
    // P9D-SEASON-RULES-01: unknown by default — a fixture that wants a
    // seasonal rule to see a real taxon/placement says so explicitly,
    // never inherits one by accident.
    taxonomyReferenceId: null,
    gardenAreaMapObjectId: null,
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
    hemisphere: null,
    taxonomyFacts: [],
    priorBedOccupants: [],
    ...overrides,
  };
}

/**
 * A `horticulturally_reviewed` seasonal fact for `TAXONOMY_A_ID`/northern
 * hemisphere by default — every timing/duration field `null` unless
 * overridden via `timingOverrides` (the domain's own "unknown stays
 * unknown" default, made explicit here rather than a fixture accidentally
 * inheriting a fabricated window).
 */
export function reviewedSeasonalFact(
  timingOverrides: Partial<TaxonomySeasonalTiming> = {},
  taxonomyReferenceId: string = TAXONOMY_A_ID,
): TaxonomySeasonalFact {
  return {
    id: SEASONAL_FACT_A_ID,
    taxonomyReferenceId,
    hemisphere: 'northern',
    sowIndoorsStartMonth: null,
    sowIndoorsEndMonth: null,
    sowOutdoorsStartMonth: null,
    sowOutdoorsEndMonth: null,
    transplantStartMonth: null,
    transplantEndMonth: null,
    harvestStartMonth: null,
    harvestEndMonth: null,
    daysToMaturityMin: null,
    daysToMaturityMax: null,
    successionIntervalDays: null,
    rotationRestSeasons: null,
    authoringMethod: 'human_authored',
    reviewStatus: 'horticulturally_reviewed',
    reviewedBy: 'Fixture Reviewer',
    reviewedOn: '2026-01-01',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...timingOverrides,
  };
}

/** One `GardenFacts.taxonomyFacts` entry — `seasonalFact: null` (the default) is how a fixture represents "no `horticulturally_reviewed` fact exists", whether the row is absent or still `awaiting_horticultural_review`; both collapse to the identical `null` the real repository's own filter already produces. */
export function taxonomyFact(overrides: Partial<TaxonomyFact> = {}): TaxonomyFact {
  return {
    taxonomyReferenceId: TAXONOMY_A_ID,
    family: 'Solanaceae',
    seasonalFact: null,
    ...overrides,
  };
}

/** One `GardenFacts.priorBedOccupants` entry — both `priorFamily`/`priorOccupancyEndedAt` default to `null` ("no known conflict"), matching `gather-seasonal-facts.ts`'s own null-together invariant for "no departed occupant found". */
export function priorBedOccupant(
  overrides: Partial<PriorBedOccupantFact> & { plantId: string },
): PriorBedOccupantFact {
  return {
    gardenAreaMapObjectId: GARDEN_AREA_A_ID,
    priorFamily: null,
    priorOccupancyEndedAt: null,
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
    postponedUntil: null,
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

/**
 * The identical text `HEMISPHERE_UNKNOWN_DETAIL`
 * (`domain/rules/rule-support.ts`) carries — duplicated here rather than
 * imported, the same "fixtures own small constants locally" convention
 * `HOUR_MS`/`DAY_MS` above already follow (neither is imported from
 * `rule-support.ts` either).
 */
const HEMISPHERE_UNKNOWN_DETAIL =
  "This garden has never been georeferenced, so its hemisphere — and therefore any taxon's " +
  'reviewed seasonal timing — is unknown.';

/**
 * The three P9D-SEASON-RULES-01 seasonal rules ALL skip identically
 * (a rule-level `factMissing` skip, not a per-target one — see each
 * rule's own header) whenever `GardenFacts.hemisphere` is `null`, which is
 * `gardenFacts()`'s own default. Every pre-existing fixture file (whose
 * scenarios never set `hemisphere`) therefore gets exactly these three
 * decisions appended, in catalog order, after the four original rules'
 * own decisions — catalog order is evaluation order, and the three
 * seasonal rules were appended AFTER the original four
 * (`launch-rule-catalog.ts`).
 */
export const SEASONAL_RULES_HEMISPHERE_SKIPS: readonly RuleDecision[] = [
  ruleSkippedDecision('seasonal.sowing-window-check', {
    kind: 'factMissing',
    detail: HEMISPHERE_UNKNOWN_DETAIL,
  }),
  ruleSkippedDecision('succession.replanting-reminder', {
    kind: 'factMissing',
    detail: HEMISPHERE_UNKNOWN_DETAIL,
  }),
  ruleSkippedDecision('rotation.crop-rotation-caution', {
    kind: 'factMissing',
    detail: HEMISPHERE_UNKNOWN_DETAIL,
  }),
];

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
