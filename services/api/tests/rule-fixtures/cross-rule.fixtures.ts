/**
 * Cross-rule fixtures — see README.md for how to review. Covers the
 * engine behaviors that only show with several rules or prior state in
 * play: duplicate suppression against LIVE CANDIDATES, duplicate
 * suppression against an OPEN TASK provably converted from the same rule
 * (while a manual task on the same plant only lowers priority), and the
 * relative PRIORITY ORDERING when several rules fire in one garden.
 */

import type { RuleFixture } from './fixture-support.js';
import {
  ACTIVE_WATERING_RULE_VERSION,
  DAY_MS,
  FIXTURE_NOW,
  HOUR_MS,
  PLANT_A_ID,
  PLANT_B_ID,
  PRIOR_CANDIDATE_A_ID,
  PRIOR_CANDIDATE_B_ID,
  SEASONAL_RULES_HEMISPHERE_SKIPS,
  TASK_A_ID,
  TASK_B_ID,
  WEATHER_FORECAST_ID,
  WEATHER_OBSERVATION_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  rainlessWeek,
  priorCandidate,
  ruleSkippedDecision,
  suppressedDecision,
  weatherForecastFact,
  weatherObservationFact,
} from './fixture-support.js';

const TWENTY_DAYS_AGO = new Date(FIXTURE_NOW.getTime() - 20 * DAY_MS);

export const crossRuleFixtures: readonly RuleFixture[] = [
  {
    name: 'duplicate suppression: current live candidates from a prior evaluation suppress regeneration entirely',
    reviewNotes:
      'A re-evaluation over unchanged facts: the observation reminder and the harvest check ' +
      'each already have a live, still-current candidate. Both report suppressed with the ' +
      'exact prior candidate named, and nothing is written — running the engine twice is a ' +
      'no-op, which is what makes scheduled re-evaluation safe.',
    facts: gardenFacts({
      plants: [
        plantFact({
          plantId: PLANT_A_ID,
          lifecycleStage: 'ready_to_harvest',
          createdAt: TWENTY_DAYS_AGO,
        }),
      ],
    }),
    prior: (() => {
      const liveObservation = priorCandidate({
        candidateId: PRIOR_CANDIDATE_A_ID,
        ruleKey: 'observation.routine-check-reminder',
        state: 'presented',
        revision: 2,
        windowEnd: new Date(FIXTURE_NOW.getTime() + 6 * DAY_MS),
      });
      const liveHarvest = priorCandidate({
        candidateId: PRIOR_CANDIDATE_B_ID,
        ruleKey: 'lifecycle.harvest-readiness-check',
        windowEnd: new Date(FIXTURE_NOW.getTime() + 4 * DAY_MS),
      });
      return {
        liveCandidates: [liveObservation, liveHarvest],
        latestPerRuleAndTarget: [liveObservation, liveHarvest],
      };
    })(),
    expected: {
      decisions: [
        ruleSkippedDecision(
          'watering.dry-spell-check',
          { kind: 'weatherMissing', requiredKind: 'observation' },
          ACTIVE_WATERING_RULE_VERSION,
        ),
        suppressedDecision('observation.routine-check-reminder', PLANT_A_ID, {
          kind: 'liveCandidateExists',
          candidateId: PRIOR_CANDIDATE_A_ID,
        }),
        suppressedDecision('lifecycle.harvest-readiness-check', PLANT_A_ID, {
          kind: 'liveCandidateExists',
          candidateId: PRIOR_CANDIDATE_B_ID,
        }),
        ruleSkippedDecision('weather.frost-watch', {
          kind: 'weatherMissing',
          requiredKind: 'forecast',
        }),
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'task equivalence: a suggested task from this rule’s own candidate suppresses; a manual task only lowers priority',
    reviewNotes:
      'Plant A’s harvest recommendation was already converted into an open suggested task, so ' +
      'the harvest rule is suppressed by that task. Plant B has an unrelated MANUAL open task: ' +
      'manual equivalence is undecidable (free-text titles, no category vocabulary), so the ' +
      'watering check still fires but carries a task-overlap penalty (priority 80 → 65) naming ' +
      'the overlapping task. Review: is suppress-on-provable-conversion plus ' +
      'penalize-on-manual-overlap the right duplicate policy?',
    facts: gardenFacts({
      plants: [
        plantFact({ plantId: PLANT_A_ID, lifecycleStage: 'ready_to_harvest' }),
        plantFact({ plantId: PLANT_B_ID, displayName: 'Basil pot' }),
      ],
      openTasks: [
        {
          taskId: TASK_A_ID,
          target: plantTarget(PLANT_A_ID),
          originRuleKey: 'lifecycle.harvest-readiness-check',
        },
        { taskId: TASK_B_ID, target: plantTarget(PLANT_B_ID), originRuleKey: null },
      ],
      weatherObservation: weatherObservationFact(),
      recentPrecipitation: rainlessWeek(),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        notEligibleDecision(
          'watering.dry-spell-check',
          PLANT_A_ID,
          'plant.lifecycle_stage_not_active_growth',
          ACTIVE_WATERING_RULE_VERSION,
        ),
        fireDecision(
          'watering.dry-spell-check',
          PLANT_B_ID,
          70,
          null,
          ACTIVE_WATERING_RULE_VERSION,
        ),
        notEligibleDecision(
          'observation.routine-check-reminder',
          PLANT_A_ID,
          'plant.recently_observed',
        ),
        notEligibleDecision(
          'observation.routine-check-reminder',
          PLANT_B_ID,
          'plant.recently_observed',
        ),
        suppressedDecision('lifecycle.harvest-readiness-check', PLANT_A_ID, {
          kind: 'openTaskExists',
          taskId: TASK_A_ID,
        }),
        notEligibleDecision(
          'lifecycle.harvest-readiness-check',
          PLANT_B_ID,
          'plant.not_ready_to_harvest',
        ),
        ruleSkippedDecision('weather.frost-watch', {
          kind: 'weatherMissing',
          requiredKind: 'forecast',
        }),
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [
        {
          ruleKey: 'watering.dry-spell-check',
          ruleVersion: ACTIVE_WATERING_RULE_VERSION,
          safetyTier: 'ordinary_care',
          careCategory: 'watering',
          target: plantTarget(PLANT_B_ID),
          urgency: 'normal',
          windowStart: FIXTURE_NOW,
          windowEnd: new Date(FIXTURE_NOW.getTime() + 48 * HOUR_MS),
          evidence: [
            {
              kind: 'weather',
              sourceObservationId: null,
              sourceTaskId: null,
              sourcePlantId: null,
              sourceWeatherRecordId: WEATHER_OBSERVATION_ID,
              factKey: 'weather.accumulated_rainfall',
              factValue: {
                windowDays: 7,
                totalMm: 0,
                daysCovered: 7,
                lastWetDayAt: null,
                temperatureCelsius: 27,
                freshness: 'fresh',
              },
            },
            {
              kind: 'lifecycle_stage',
              sourceObservationId: null,
              sourceTaskId: null,
              sourcePlantId: PLANT_B_ID,
              sourceWeatherRecordId: null,
              factKey: 'plant.lifecycle_stage',
              factValue: { lifecycleStage: 'growing' },
            },
          ],
          factors: [
            {
              kind: 'urgency_window',
              contribution: 20,
              basis: { urgency: 'normal', validityWindowHours: 48 },
            },
            {
              kind: 'weather_opportunity_or_risk',
              contribution: 30,
              basis: { totalMm: 0, thresholdMm: 12.5, shortfallMm: 25 },
            },
            { kind: 'plant_impact', contribution: 15, basis: { lifecycleStage: 'growing' } },
            {
              kind: 'confidence',
              contribution: 20,
              basis: { weatherFreshness: 'fresh', daysCovered: 7 },
            },
            {
              kind: 'task_overlap',
              contribution: -15,
              basis: { openTaskIds: [TASK_B_ID] },
            },
          ],
          priorityScore: 70,
          explanation:
            'This garden has had 0 mm of rain over the last 7 days — about 25 mm less than ' +
            'the window usually supplies — and the latest reading is 27 °C. Basil pot is in ' +
            'its growing stage, so check whether it needs watering.',
          supersedesCandidateId: null,
          supersedesLiveCandidate: null,
        },
      ],
    },
  },
  {
    name: 'priority ordering: frost warning above watering check above observation reminder',
    reviewNotes:
      'One flowering plant, unobserved for 20 days, on a warm dry day with a freezing ' +
      'overnight forecast: three rules fire at once. The stored factors order them frost (95) ' +
      '> watering (80) > observation reminder (40). Review: does this relative ordering match ' +
      'horticultural common sense — hazard first, opportunity second, routine last?',
    facts: gardenFacts({
      plants: [
        plantFact({
          plantId: PLANT_A_ID,
          displayName: 'Strawberry patch',
          lifecycleStage: 'flowering',
          createdAt: TWENTY_DAYS_AGO,
        }),
      ],
      weatherObservation: weatherObservationFact(),
      weatherForecast: weatherForecastFact(),
      recentPrecipitation: rainlessWeek(),
    }),
    prior: noPrior(),
    expectedPriorityOrder: [
      'weather.frost-watch',
      'watering.dry-spell-check',
      'observation.routine-check-reminder',
    ],
    expected: {
      decisions: [
        fireDecision(
          'watering.dry-spell-check',
          PLANT_A_ID,
          85,
          null,
          ACTIVE_WATERING_RULE_VERSION,
        ),
        fireDecision('observation.routine-check-reminder', PLANT_A_ID, 40),
        notEligibleDecision(
          'lifecycle.harvest-readiness-check',
          PLANT_A_ID,
          'plant.not_ready_to_harvest',
        ),
        fireDecision('weather.frost-watch', PLANT_A_ID, 95),
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [
        {
          ruleKey: 'watering.dry-spell-check',
          ruleVersion: ACTIVE_WATERING_RULE_VERSION,
          safetyTier: 'ordinary_care',
          careCategory: 'watering',
          target: plantTarget(PLANT_A_ID),
          urgency: 'normal',
          windowStart: FIXTURE_NOW,
          windowEnd: new Date(FIXTURE_NOW.getTime() + 48 * HOUR_MS),
          evidence: [
            {
              kind: 'weather',
              sourceObservationId: null,
              sourceTaskId: null,
              sourcePlantId: null,
              sourceWeatherRecordId: WEATHER_OBSERVATION_ID,
              factKey: 'weather.accumulated_rainfall',
              factValue: {
                windowDays: 7,
                totalMm: 0,
                daysCovered: 7,
                lastWetDayAt: null,
                temperatureCelsius: 27,
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
              contribution: 20,
              basis: { urgency: 'normal', validityWindowHours: 48 },
            },
            {
              kind: 'weather_opportunity_or_risk',
              contribution: 30,
              basis: { totalMm: 0, thresholdMm: 12.5, shortfallMm: 25 },
            },
            { kind: 'plant_impact', contribution: 15, basis: { lifecycleStage: 'flowering' } },
            {
              kind: 'confidence',
              contribution: 20,
              basis: { weatherFreshness: 'fresh', daysCovered: 7 },
            },
          ],
          priorityScore: 85,
          explanation:
            'This garden has had 0 mm of rain over the last 7 days — about 25 mm less than ' +
            'the window usually supplies — and the latest reading is 27 °C. Strawberry patch ' +
            'is in its flowering stage, so check whether it needs watering.',
          supersedesCandidateId: null,
          supersedesLiveCandidate: null,
        },
        {
          ruleKey: 'observation.routine-check-reminder',
          ruleVersion: 1,
          safetyTier: 'ordinary_care',
          careCategory: 'observation',
          target: plantTarget(PLANT_A_ID),
          urgency: 'low',
          windowStart: FIXTURE_NOW,
          windowEnd: new Date(FIXTURE_NOW.getTime() + 7 * DAY_MS),
          evidence: [
            {
              kind: 'plant_identity',
              sourceObservationId: null,
              sourceTaskId: null,
              sourcePlantId: PLANT_A_ID,
              sourceWeatherRecordId: null,
              factKey: 'plant.observation_recency',
              factValue: { lastObservedAt: null, baseline: 'plant_created_at', daysSince: 20 },
            },
          ],
          factors: [
            {
              kind: 'urgency_window',
              contribution: 10,
              basis: { urgency: 'low', validityWindowDays: 7 },
            },
            { kind: 'plant_impact', contribution: 10, basis: { lifecycleStage: 'flowering' } },
            {
              kind: 'confidence',
              contribution: 20,
              basis: { source: 'own_records', daysSince: 20 },
            },
          ],
          priorityScore: 40,
          explanation:
            'Strawberry patch has not been observed for 20 days. Record a quick check of its ' +
            'condition.',
          supersedesCandidateId: null,
          supersedesLiveCandidate: null,
        },
        {
          ruleKey: 'weather.frost-watch',
          ruleVersion: 1,
          safetyTier: 'elevated_risk',
          careCategory: 'weather_protection',
          target: plantTarget(PLANT_A_ID),
          urgency: 'urgent',
          windowStart: FIXTURE_NOW,
          windowEnd: new Date('2026-07-26T03:00:00Z'),
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
                effectiveAt: '2026-07-26T03:00:00.000Z',
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
];
