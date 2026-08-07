/**
 * `watering.dry-spell-check` v2 — ordinary care.
 *
 * WHY A NEW VERSION RATHER THAN AN EDIT: the catalog is append-only, and
 * this changes what the rule MEANS, not only its numbers. v1 stays shipped
 * forever so a candidate it produced can still render its own explanation.
 *
 * WHAT CHANGED, AND WHY IT MATTERED. v1 read a SINGLE latest observation's
 * `precipitationMm` and called anything at or below 0.5 mm "essentially
 * rain-free". That figure is one provider-defined period — for Open-Meteo's
 * `current` block, the preceding hour. An hour without rain is not a dry
 * spell; it is an hour. A garden could be recommended a watering check in
 * the hour after a thunderstorm, and a genuinely parched garden went
 * unmentioned whenever the last hour happened to be damp.
 *
 * v2 decides on ACCUMULATION: total rainfall across a window of whole
 * elapsed days, plus how long since the last day that produced meaningful
 * rain. That is the question a gardener actually asks.
 *
 * WHAT IT SAYS: when the garden's recent rainfall is below what the window
 * would normally supply and the latest reading is warm, suggest CHECKING
 * whether each actively growing plant needs water — and state the shortfall
 * in millimetres so the person can judge scale. It recommends a check and
 * quantifies a deficit; it never prescribes a dose or a schedule, and it
 * never claims to know the soil.
 *
 * INSUFFICIENT HISTORY IS A SKIP, NOT A DRY SPELL. A window holding two
 * days of measurements says nothing about seven, so the rule requires
 * `minimumDaysCovered` before it will call anything dry. Reading a small
 * total over a short history as drought is exactly the invented-value
 * mistake, and it would fire hardest on gardens that just started
 * collecting weather — the ones with the least reason to trust it.
 *
 * STALE-WEATHER POSTURE: `useLabeledStale`, unchanged from v1. The
 * temperature reading may be slightly aged for a low-stakes check, and the
 * confidence factor drops accordingly. The rainfall history behind the
 * decision is made of elapsed days and does not go stale the same way.
 *
 * REVIEW STATUS: awaiting horticultural review. The thresholds below —
 * window length, the reference supply figure, what counts as meaningful
 * rain, the warm-day temperature and the stage list — are defensible
 * placeholders a horticulturist must confirm or correct. The deficit is
 * deliberately expressed as "rainfall short of a reference supply", not as
 * a soil-moisture claim: this system stores no soil facts, and a rule must
 * not imply an input nobody measured.
 *
 * Source: architecture/recommendations-and-ai.md, sections "4. Structured
 * Inputs", "5. Rule Engine" and "13. Safety Tiers".
 */

import type { GardenFacts } from '../garden-facts.js';
import { summarizePrecipitationSince } from '../garden-facts.js';
import type { LifecycleStage } from '../../../plants-inventory/public.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import { DAY_MS, HOUR_MS, plantTarget } from './rule-support.js';

const PARAMETERS = {
  /** How many elapsed days the rainfall total is summed over. */
  dryWindowDays: 7,
  /**
   * The rainfall this window would normally supply, in millimetres. The
   * shortfall against it is what the explanation reports. A reference
   * supply figure, NOT a soil-moisture model — this system stores no soil
   * facts and this rule must not imply one.
   */
  referenceWeeklySupplyMm: 25,
  /** Below this share of the reference supply, the window counts as dry. */
  deficitFraction: 0.5,
  /** A day's own total at or above this depth counts as real rain rather than a trace that never reaches roots. */
  meaningfulRainMm: 2,
  /** Fewer measured days than this and the rule refuses to call anything dry. */
  minimumDaysCovered: 4,
  /** A latest reading at or above this counts as warm enough for water loss to matter. */
  warmDayCelsius: 20,
  validityWindowHours: 48,
  recurrenceIntervalHours: 72,
} as const;

/** Stages in which a plant is actively growing and transpiring — the stages a watering check is worth suggesting for. */
const ACTIVE_GROWTH_STAGES: readonly LifecycleStage[] = [
  'seedling',
  'transplanted',
  'growing',
  'flowering',
  'fruiting',
];

const CONFIDENCE_FRESH_WEATHER = 20;
const CONFIDENCE_STALE_WEATHER = 8;

/** The deficit threshold in millimetres — derived, so the two parameters cannot drift apart. */
const DRY_THRESHOLD_MM = PARAMETERS.referenceWeeklySupplyMm * PARAMETERS.deficitFraction;

function evaluate(facts: GardenFacts): ReturnType<RuleDefinition['evaluate']> {
  const weather = facts.weatherObservation;
  if (weather.availability === 'missing') {
    // Unreachable behind the engine's weather gate; kept as an honest guard.
    return {
      outcome: 'skipped',
      reason: { kind: 'weatherMissing', requiredKind: 'observation' },
    };
  }
  const { temperatureCelsius } = weather.measurements;
  if (temperatureCelsius === null) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'The latest weather observation lacks a temperature measurement.',
      },
    };
  }
  if (facts.recentPrecipitation === null) {
    // No measured rainfall history at all. UNKNOWN, not dry — recommending
    // a watering check here would be a guess dressed as a measurement.
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'This garden has no measured rainfall history to accumulate.',
      },
    };
  }

  const windowStart = new Date(facts.evaluatedAt.getTime() - PARAMETERS.dryWindowDays * DAY_MS);
  const rainfall = summarizePrecipitationSince(
    facts.recentPrecipitation,
    windowStart,
    PARAMETERS.meaningfulRainMm,
  );

  if (rainfall.daysCovered < PARAMETERS.minimumDaysCovered) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: `Only ${String(rainfall.daysCovered)} measured day(s) of rainfall — too little history to call a dry spell.`,
      },
    };
  }
  if (temperatureCelsius < PARAMETERS.warmDayCelsius) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'Current conditions are not warm enough for a watering check.',
      },
    };
  }
  if (rainfall.totalMm >= DRY_THRESHOLD_MM) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'Recent rainfall is close enough to what this window normally supplies.',
      },
    };
  }

  const shortfallMm = Math.round((PARAMETERS.referenceWeeklySupplyMm - rainfall.totalMm) * 10) / 10;
  const daysSinceRain =
    rainfall.lastWetDayAt === null
      ? null
      : Math.floor((facts.evaluatedAt.getTime() - rainfall.lastWetDayAt.getTime()) / DAY_MS);

  const targets: RuleTargetEvaluation[] = facts.plants.map((plant) => {
    if (plant.status !== 'active') {
      return {
        outcome: 'notEligible',
        target: plantTarget(plant.plantId),
        reasonCode: 'plant.status_not_active',
      };
    }
    if (!ACTIVE_GROWTH_STAGES.includes(plant.lifecycleStage)) {
      return {
        outcome: 'notEligible',
        target: plantTarget(plant.plantId),
        reasonCode: 'plant.lifecycle_stage_not_active_growth',
      };
    }
    return {
      outcome: 'eligible',
      target: plantTarget(plant.plantId),
      evidence: [
        {
          kind: 'weather',
          sourceObservationId: null,
          sourceTaskId: null,
          sourcePlantId: null,
          sourceWeatherRecordId: weather.weatherRecordId,
          factKey: 'weather.accumulated_rainfall',
          factValue: {
            windowDays: PARAMETERS.dryWindowDays,
            totalMm: rainfall.totalMm,
            daysCovered: rainfall.daysCovered,
            lastWetDayAt: rainfall.lastWetDayAt?.toISOString() ?? null,
            temperatureCelsius,
            freshness: weather.freshness,
          },
        },
        {
          kind: 'lifecycle_stage',
          sourceObservationId: null,
          sourceTaskId: null,
          sourcePlantId: plant.plantId,
          sourceWeatherRecordId: null,
          factKey: 'plant.lifecycle_stage',
          factValue: { lifecycleStage: plant.lifecycleStage },
        },
      ],
      factors: [
        {
          kind: 'urgency_window',
          contribution: 20,
          basis: { urgency: 'normal', validityWindowHours: PARAMETERS.validityWindowHours },
        },
        {
          kind: 'weather_opportunity_or_risk',
          // Scales with how far short the window fell, so a garden that has
          // had almost nothing outranks one that is merely below average.
          contribution: rainfall.totalMm <= DRY_THRESHOLD_MM / 2 ? 30 : 20,
          basis: {
            totalMm: rainfall.totalMm,
            thresholdMm: DRY_THRESHOLD_MM,
            shortfallMm,
          },
        },
        {
          kind: 'plant_impact',
          contribution: 15,
          basis: { lifecycleStage: plant.lifecycleStage },
        },
        {
          kind: 'confidence',
          contribution:
            weather.freshness === 'fresh' ? CONFIDENCE_FRESH_WEATHER : CONFIDENCE_STALE_WEATHER,
          basis: { weatherFreshness: weather.freshness, daysCovered: rainfall.daysCovered },
        },
      ],
      explanationFacts: {
        'plant.display_name': plant.displayName,
        'plant.lifecycle_stage': plant.lifecycleStage,
        'weather.window_days': PARAMETERS.dryWindowDays,
        'weather.rainfall_total_mm': rainfall.totalMm,
        'weather.rainfall_shortfall_mm': shortfallMm,
        'weather.temperature_celsius': temperatureCelsius,
        'weather.days_since_rain': daysSinceRain ?? PARAMETERS.dryWindowDays,
      },
      windowEnd: null,
    };
  });

  return { outcome: 'evaluated', targets };
}

export const wateringDrySpellCheckV2Rule: RuleDefinition = {
  ruleKey: 'watering.dry-spell-check',
  version: 2,
  safetyTier: 'ordinary_care',
  careCategory: 'watering',
  actionTitle: 'Check whether this plant needs watering',
  description:
    'Suggests a watering check for each actively growing plant when rainfall accumulated over ' +
    'recent elapsed days falls short of what the window normally supplies and the latest reading ' +
    'is warm. Reports the shortfall in millimetres. Recommends checking, never a watering amount ' +
    'or schedule, and never claims to know the soil.',
  urgency: 'normal',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowHours * HOUR_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalHours * HOUR_MS,
  },
  weatherPolicy: { use: 'required', kind: 'observation', whenStale: 'useLabeledStale' },
  requiredEvidenceKinds: ['weather', 'lifecycle_stage'],
  explanationTemplate:
    'This garden has had {weather.rainfall_total_mm} mm of rain over the last ' +
    '{weather.window_days} days — about {weather.rainfall_shortfall_mm} mm less than the window ' +
    'usually supplies — and the latest reading is {weather.temperature_celsius} °C. ' +
    '{plant.display_name} is in its {plant.lifecycle_stage} stage, so check whether it needs ' +
    'watering.',
  parameters: PARAMETERS,
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P7-SAFE-01' },
  evaluate,
};
