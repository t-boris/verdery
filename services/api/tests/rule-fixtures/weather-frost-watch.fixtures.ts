/**
 * Fixtures for `weather.frost-watch` v1 (the one ELEVATED-RISK launch
 * rule) — see README.md for how to review. Covers: firing for
 * frost-sensitive stages with the validity window ending AT the forecast
 * moment, the strict stale-forecast skip (elevated risk uses no stale
 * data), the passed-forecast skip, and the above-threshold skip.
 */

import type { RuleFixture } from './fixture-support.js';
import {
  FIXTURE_NOW,
  HOUR_MS,
  PLANT_A_ID,
  PLANT_B_ID,
  WEATHER_FORECAST_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  ruleSkippedDecision,
  weatherForecastFact,
} from './fixture-support.js';

const WATERING_SKIPS = ruleSkippedDecision('watering.dry-spell-check', {
  kind: 'weatherMissing',
  requiredKind: 'observation',
});

const FORECAST_MOMENT = new Date('2026-07-26T03:00:00Z');

const FLOWERING_AND_GROWING = [
  plantFact({ plantId: PLANT_A_ID, displayName: 'Strawberry patch', lifecycleStage: 'flowering' }),
  plantFact({ plantId: PLANT_B_ID, displayName: 'Leek row', lifecycleStage: 'growing' }),
];

const QUIET_MIDDLE_RULES = [
  notEligibleDecision('observation.routine-check-reminder', PLANT_A_ID, 'plant.recently_observed'),
  notEligibleDecision('observation.routine-check-reminder', PLANT_B_ID, 'plant.recently_observed'),
  notEligibleDecision(
    'lifecycle.harvest-readiness-check',
    PLANT_A_ID,
    'plant.not_ready_to_harvest',
  ),
  notEligibleDecision(
    'lifecycle.harvest-readiness-check',
    PLANT_B_ID,
    'plant.not_ready_to_harvest',
  ),
] as const;

export const weatherFrostWatchFixtures: readonly RuleFixture[] = [
  {
    name: 'warns frost-sensitive plants about a fresh freezing forecast, window ending at the forecast moment',
    reviewNotes:
      'A fresh forecast shows −2 °C at 03:00 tomorrow. The flowering plant gets an urgent ' +
      'warning at priority 95 whose validity window ends exactly at the forecast moment; the ' +
      'growing plant is deemed not frost-sensitive. The confidence factor is deliberately low ' +
      '(10) and the explanation says “may be frost-sensitive” — elevated-risk uncertainty made ' +
      'explicit. Review: is 0 °C the right threshold, and are seedling/transplanted/flowering ' +
      'the right sensitive stages? Is suggesting protective cover (and nothing more) the safe ' +
      'action?',
    facts: gardenFacts({
      plants: FLOWERING_AND_GROWING,
      weatherForecast: weatherForecastFact(),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        WATERING_SKIPS,
        ...QUIET_MIDDLE_RULES,
        fireDecision('weather.frost-watch', PLANT_A_ID, 95),
        notEligibleDecision(
          'weather.frost-watch',
          PLANT_B_ID,
          'plant.lifecycle_stage_not_frost_sensitive',
        ),
      ],
      plannedCandidates: [
        {
          ruleKey: 'weather.frost-watch',
          ruleVersion: 1,
          safetyTier: 'elevated_risk',
          careCategory: 'weather_protection',
          target: plantTarget(PLANT_A_ID),
          urgency: 'urgent',
          windowStart: FIXTURE_NOW,
          windowEnd: FORECAST_MOMENT,
          evidence: [
            {
              kind: 'weather',
              sourceObservationId: null,
              sourceTaskId: null,
              sourcePlantId: null,
              sourceWeatherRecordId: WEATHER_FORECAST_ID,
              factKey: 'weather.frost_forecast',
              factValue: {
                temperatureCelsius: -2,
                effectiveAt: FORECAST_MOMENT.toISOString(),
                freshness: 'fresh',
              },
            },
            {
              kind: 'lifecycle_stage',
              sourceObservationId: null,
              sourceTaskId: null,
              sourcePlantId: PLANT_A_ID,
              sourceWeatherRecordId: null,
              factKey: 'plant.lifecycle_stage',
              factValue: { lifecycleStage: 'flowering' },
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
              basis: { forecastTemperatureCelsius: -2, frostThresholdCelsius: 0 },
            },
            { kind: 'plant_impact', contribution: 20, basis: { lifecycleStage: 'flowering' } },
            {
              kind: 'confidence',
              contribution: 10,
              basis: { safetyTier: 'elevated_risk', source: 'forecast' },
            },
          ],
          priorityScore: 95,
          explanation:
            'The forecast for this garden shows -2 °C around 2026-07-26T03:00:00.000Z. ' +
            'Strawberry patch is in its flowering stage and may be frost-sensitive. Consider ' +
            'covering it overnight.',
          supersedesCandidateId: null,
          supersedesLiveCandidate: null,
        },
      ],
    },
  },
  {
    name: 'skips ENTIRELY on a stale forecast — elevated risk uses no stale data',
    reviewNotes:
      'The same freezing forecast, but past its freshness window. Unlike the watering rule, ' +
      'this elevated-risk rule declares stale data unusable, so it produces nothing rather ' +
      'than a lower-confidence hazard warning. Review: is refusing stale forecasts the right ' +
      'posture for a frost warning?',
    facts: gardenFacts({
      plants: FLOWERING_AND_GROWING,
      weatherForecast: weatherForecastFact({ freshness: 'stale' }),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        WATERING_SKIPS,
        ...QUIET_MIDDLE_RULES,
        ruleSkippedDecision('weather.frost-watch', {
          kind: 'weatherStale',
          requiredKind: 'forecast',
        }),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'skips a forecast whose moment already passed',
    reviewNotes:
      'The stored forecast is about two hours AGO. There is nothing upcoming to warn about, ' +
      'so the rule skips with a typed missing-fact reason instead of warning about the past.',
    facts: gardenFacts({
      plants: FLOWERING_AND_GROWING,
      weatherForecast: weatherForecastFact({
        effectiveAt: new Date(FIXTURE_NOW.getTime() - 2 * HOUR_MS),
      }),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        WATERING_SKIPS,
        ...QUIET_MIDDLE_RULES,
        ruleSkippedDecision('weather.frost-watch', {
          kind: 'factMissing',
          detail: 'The latest forecast is not about an upcoming moment.',
        }),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'stays quiet when the forecast is above the frost threshold',
    reviewNotes:
      'A fresh +4 °C overnight forecast: no frost risk, no warning, and the skip reason says ' +
      'exactly why.',
    facts: gardenFacts({
      plants: FLOWERING_AND_GROWING,
      weatherForecast: weatherForecastFact({
        measurements: {
          temperatureCelsius: 4,
          precipitationMm: null,
          windSpeedMps: null,
          humidityPercent: null,
        },
      }),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        WATERING_SKIPS,
        ...QUIET_MIDDLE_RULES,
        ruleSkippedDecision('weather.frost-watch', {
          kind: 'factMissing',
          detail: 'The upcoming forecast does not indicate frost risk.',
        }),
      ],
      plannedCandidates: [],
    },
  },
];
