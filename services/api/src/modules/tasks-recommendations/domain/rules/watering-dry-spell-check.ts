/**
 * `watering.dry-spell-check` v1 — ordinary care ("Watering ... can use the
 * standard rule and explanation pipeline", section 13).
 *
 * WHAT IT SAYS: when the garden's latest weather observation shows a warm,
 * essentially rain-free reading, suggest CHECKING whether each actively
 * growing plant needs water. It recommends a check, never a dosage or
 * schedule — the plant may well be fine.
 *
 * FACTS CONSULTED: the latest normalized weather observation (temperature
 * and precipitation — both must be PRESENT; a reading that lacks either
 * measurement skips the rule with `factMissing`, nothing invented), and
 * each plant's status and lifecycle stage.
 *
 * STALE-WEATHER POSTURE: `useLabeledStale` — a slightly aged reading still
 * supports a low-stakes watering check, but the confidence factor drops
 * (`CONFIDENCE_STALE_WEATHER` vs `CONFIDENCE_FRESH_WEATHER`) and both the
 * evidence row and the factor basis carry the `stale` label, per
 * external-integrations.md section 11's "Cached stale data is labeled and
 * used only when product rules permit it" — this rule is the product rule
 * permitting it.
 *
 * REVIEW STATUS: awaiting horticultural review (P7-SAFE-01). The
 * thresholds in `parameters` and the stage list below are defensible
 * placeholders a horticulturist must confirm or correct.
 */

import type { GardenFacts } from '../garden-facts.js';
import type { LifecycleStage } from '../../../plants-inventory/public.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import { plantTarget } from './rule-support.js';
import { HOUR_MS } from './rule-support.js';

const PARAMETERS = {
  /** A day at or above this reading counts as warm enough to dry soil quickly. */
  hotDayCelsius: 24,
  /** Precipitation at or below this depth counts as essentially rain-free. */
  drySpellPrecipitationMmMax: 0.5,
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

function evaluate(facts: GardenFacts): ReturnType<RuleDefinition['evaluate']> {
  const weather = facts.weatherObservation;
  if (weather.availability === 'missing') {
    // Unreachable behind the engine's weather gate; kept as an honest guard.
    return {
      outcome: 'skipped',
      reason: { kind: 'weatherMissing', requiredKind: 'observation' },
    };
  }
  const { temperatureCelsius, precipitationMm } = weather.measurements;
  if (temperatureCelsius === null || precipitationMm === null) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'The latest weather observation lacks a temperature or precipitation measurement.',
      },
    };
  }
  if (
    temperatureCelsius < PARAMETERS.hotDayCelsius ||
    precipitationMm > PARAMETERS.drySpellPrecipitationMmMax
  ) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'Current weather does not indicate a warm dry spell.',
      },
    };
  }

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
          factKey: 'weather.dry_spell_observation',
          factValue: {
            temperatureCelsius,
            precipitationMm,
            freshness: weather.freshness,
            effectiveAt: weather.effectiveAt.toISOString(),
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
          contribution: 25,
          basis: { temperatureCelsius, precipitationMm },
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
          basis: { weatherFreshness: weather.freshness },
        },
      ],
      explanationFacts: {
        'plant.display_name': plant.displayName,
        'plant.lifecycle_stage': plant.lifecycleStage,
        'weather.temperature_celsius': temperatureCelsius,
        'weather.precipitation_mm': precipitationMm,
      },
      windowEnd: null,
    };
  });

  return { outcome: 'evaluated', targets };
}

export const wateringDrySpellCheckRule: RuleDefinition = {
  ruleKey: 'watering.dry-spell-check',
  version: 1,
  safetyTier: 'ordinary_care',
  careCategory: 'watering',
  actionTitle: 'Check whether this plant needs watering',
  description:
    'Suggests a watering check for each actively growing plant when the latest weather ' +
    'observation shows a warm, essentially rain-free reading. Recommends checking, never a ' +
    'watering amount or schedule.',
  urgency: 'normal',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowHours * HOUR_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalHours * HOUR_MS,
  },
  weatherPolicy: { use: 'required', kind: 'observation', whenStale: 'useLabeledStale' },
  requiredEvidenceKinds: ['weather', 'lifecycle_stage'],
  explanationTemplate:
    'Recent weather at this garden was warm ({weather.temperature_celsius} °C) with almost no ' +
    'rain ({weather.precipitation_mm} mm). {plant.display_name} is in its ' +
    '{plant.lifecycle_stage} stage, so check whether it needs watering.',
  parameters: PARAMETERS,
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P7-SAFE-01' },
  evaluate,
};
