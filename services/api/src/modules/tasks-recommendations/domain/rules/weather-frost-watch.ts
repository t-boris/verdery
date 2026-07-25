/**
 * `weather.frost-watch` v1 — ELEVATED RISK ("weather hazards require
 * higher confidence, clear uncertainty, and reviewed sources", section
 * 13). Not restricted: it suggests protective covering, not chemicals,
 * structures, or emergency action.
 *
 * WHAT IT SAYS: when the garden's latest forecast predicts a freezing
 * reading at an upcoming moment, suggest protective cover for plants in
 * frost-sensitive stages. The explanation states uncertainty explicitly
 * ("may be frost-sensitive", a forecast) and the confidence factor is
 * deliberately LOW — the section-13 elevated-risk posture expressed in
 * the versioned content itself.
 *
 * STALE-FORECAST POSTURE: `skip`. Elevated risk requires higher
 * confidence, so a stale forecast produces NOTHING rather than a
 * lower-confidence hazard warning — the conservative reading of section
 * 13 against external-integrations.md section 11's "used only when
 * product rules permit it": this product rule does not permit it.
 *
 * TIMING: the candidate's validity window ends AT the forecast moment —
 * a frost warning is meaningless after the night it warns about — via
 * the fact-derived `windowEnd` override. A forecast whose moment already
 * passed skips with `factMissing` (there is nothing upcoming to warn
 * about).
 *
 * REVIEW STATUS: awaiting horticultural review (P7-SAFE-01). The
 * threshold and the frost-sensitive stage list are defensible
 * placeholders a horticulturist must confirm or correct.
 */

import type { GardenFacts } from '../garden-facts.js';
import type { LifecycleStage } from '../../../plants-inventory/public.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import { HOUR_MS, plantTarget } from './rule-support.js';

const PARAMETERS = {
  /** A forecast at or below this reading counts as frost risk. */
  frostThresholdCelsius: 0,
  recurrenceIntervalHours: 24,
  /** Fallback validity window; in practice the window ends at the forecast moment. */
  validityWindowHours: 48,
} as const;

/** Stages most exposed to a radiation frost: young tissue and open blossom. */
const FROST_SENSITIVE_STAGES: readonly LifecycleStage[] = ['seedling', 'transplanted', 'flowering'];

function evaluate(facts: GardenFacts): ReturnType<RuleDefinition['evaluate']> {
  const forecast = facts.weatherForecast;
  if (forecast.availability === 'missing') {
    // Unreachable behind the engine's weather gate; kept as an honest guard.
    return { outcome: 'skipped', reason: { kind: 'weatherMissing', requiredKind: 'forecast' } };
  }
  const { temperatureCelsius } = forecast.measurements;
  if (temperatureCelsius === null) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'The latest forecast lacks a temperature measurement.',
      },
    };
  }
  if (forecast.effectiveAt.getTime() <= facts.evaluatedAt.getTime()) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'The latest forecast is not about an upcoming moment.',
      },
    };
  }
  if (temperatureCelsius > PARAMETERS.frostThresholdCelsius) {
    return {
      outcome: 'skipped',
      reason: {
        kind: 'factMissing',
        detail: 'The upcoming forecast does not indicate frost risk.',
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
    if (!FROST_SENSITIVE_STAGES.includes(plant.lifecycleStage)) {
      return {
        outcome: 'notEligible',
        target: plantTarget(plant.plantId),
        reasonCode: 'plant.lifecycle_stage_not_frost_sensitive',
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
          sourceWeatherRecordId: forecast.weatherRecordId,
          factKey: 'weather.frost_forecast',
          factValue: {
            temperatureCelsius,
            effectiveAt: forecast.effectiveAt.toISOString(),
            freshness: forecast.freshness,
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
          contribution: 35,
          basis: { urgency: 'urgent', windowEndsAtForecastMoment: true },
        },
        {
          kind: 'weather_opportunity_or_risk',
          contribution: 30,
          basis: {
            forecastTemperatureCelsius: temperatureCelsius,
            frostThresholdCelsius: PARAMETERS.frostThresholdCelsius,
          },
        },
        {
          kind: 'plant_impact',
          contribution: 20,
          basis: { lifecycleStage: plant.lifecycleStage },
        },
        {
          kind: 'confidence',
          // Deliberately low: a forecast, and an elevated-risk subject —
          // section 13's "clear uncertainty" as a number.
          contribution: 10,
          basis: { safetyTier: 'elevated_risk', source: 'forecast' },
        },
      ],
      explanationFacts: {
        'plant.display_name': plant.displayName,
        'plant.lifecycle_stage': plant.lifecycleStage,
        'weather.forecast_temperature_celsius': temperatureCelsius,
        'weather.forecast_effective_at': forecast.effectiveAt.toISOString(),
      },
      windowEnd: forecast.effectiveAt,
    };
  });

  return { outcome: 'evaluated', targets };
}

export const weatherFrostWatchRule: RuleDefinition = {
  ruleKey: 'weather.frost-watch',
  version: 1,
  safetyTier: 'elevated_risk',
  careCategory: 'weather_protection',
  actionTitle: 'Consider protective cover against forecast frost',
  description:
    'Warns about an upcoming forecast at or below freezing for each active plant in a ' +
    'frost-sensitive lifecycle stage and suggests protective covering. Forecast-based and ' +
    'explicitly uncertain; skips entirely on stale forecasts.',
  urgency: 'urgent',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowHours * HOUR_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalHours * HOUR_MS,
  },
  weatherPolicy: { use: 'required', kind: 'forecast', whenStale: 'skip' },
  requiredEvidenceKinds: ['weather', 'lifecycle_stage'],
  explanationTemplate:
    'The forecast for this garden shows {weather.forecast_temperature_celsius} °C around ' +
    '{weather.forecast_effective_at}. {plant.display_name} is in its {plant.lifecycle_stage} ' +
    'stage and may be frost-sensitive. Consider covering it overnight.',
  parameters: PARAMETERS,
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P7-SAFE-01' },
  evaluate,
};
