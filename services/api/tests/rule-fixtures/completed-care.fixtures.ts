/**
 * Fixtures for the engine phase that reads WORK ACTUALLY DONE — see
 * README.md for how to review.
 *
 * Their own file rather than more of `cross-rule.fixtures.ts` for the
 * repository's 600-line rule, and because they exercise one specific
 * engine phase: recurrence measured from a completion rather than from a
 * candidate's creation.
 *
 * WHAT WAS BROKEN BEFORE THIS PHASE EXISTED. `GardenFacts.openTasks`
 * carried only planned and suggested rows. Completing a task therefore
 * removed the very fact that had been suppressing its own recommendation,
 * and the recurrence clock still ran from when the work was last
 * SUGGESTED. Watering a plant on Friday earned the same recommendation
 * again on Saturday.
 *
 * WHY EQUIVALENCE MUST BE PROVABLE. Suppression matches on the completed
 * task's originating rule key, resolved through
 * `task.origin_recommendation_id`. A manually created task carries none.
 * Its free-text title cannot be shown to mean "I watered this", and
 * treating it as if it could would silently withhold care on a guess —
 * which is why the second fixture here asserts that it does not suppress.
 */

import type { PlannedCandidate } from '../../src/modules/tasks-recommendations/public.js';
import type { RuleFixture } from './fixture-support.js';
import {
  ACTIVE_WATERING_RULE_VERSION,
  FIXTURE_NOW,
  HOUR_MS,
  PLANT_A_ID,
  SEASONAL_RULES_HEMISPHERE_SKIPS,
  TASK_A_ID,
  TASK_B_ID,
  WEATHER_OBSERVATION_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  rainlessWeek,
  ruleSkippedDecision,
  suppressedDecision,
  weatherObservationFact,
} from './fixture-support.js';

/** The standard PLANT_A watering candidate over a rainless week — identical to the one `watering-dry-spell-check.fixtures.ts` expects, reused so the two files cannot drift apart. */
function wateringCandidateForPlantA(): PlannedCandidate {
  return {
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
    ],
    priorityScore: 85,
    explanation:
      'This garden has had 0 mm of rain over the last 7 days — about 25 mm less than the ' +
      'window usually supplies — and the latest reading is 27 °C. Cherry tomato is in its ' +
      'growing stage, so check whether it needs watering.',
    supersedesCandidateId: null,
    supersedesLiveCandidate: null,
  };
}

export const completedCareFixtures: readonly RuleFixture[] = [
  {
    name: 'completed work resets the clock: watering the plant yesterday silences its own check today',
    reviewNotes:
      'A rainless week and a warm reading — conditions that fired the watering check in the ' +
      'fixtures above — but a task originating from THIS rule and target was completed one ' +
      'day ago. The rule stays silent for the rest of its 72-hour recurrence interval.\n\n' +
      'This is the case that was previously broken end to end. Completing a task removes it ' +
      'from the open-task list, which was the only thing suppressing the candidate, and the ' +
      'recurrence clock ran from the CANDIDATE\u2019s creation rather than from the moment the ' +
      'work was done. Watering on Friday earned the same recommendation again on Saturday.\n\n' +
      'The link is provable, never guessed: suppression matches on the completed task\u2019s ' +
      'originating rule key. A manual task carries none and can never suppress care it cannot ' +
      'be shown to have delivered. Review: is 72 hours the right quiet period after a watering?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact(),
      recentPrecipitation: rainlessWeek(),
      completedTasks: [
        {
          taskId: TASK_A_ID,
          target: plantTarget(PLANT_A_ID),
          originRuleKey: 'watering.dry-spell-check',
          completedAt: new Date(FIXTURE_NOW.getTime() - 24 * HOUR_MS),
        },
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        suppressedDecision(
          'watering.dry-spell-check',
          PLANT_A_ID,
          {
            kind: 'recentlyCompleted',
            taskId: TASK_A_ID,
            completedAt: new Date(FIXTURE_NOW.getTime() - 24 * HOUR_MS),
          },
          ACTIVE_WATERING_RULE_VERSION,
        ),
        notEligibleDecision(
          'observation.routine-check-reminder',
          PLANT_A_ID,
          'plant.recently_observed',
        ),
        notEligibleDecision(
          'lifecycle.harvest-readiness-check',
          PLANT_A_ID,
          'plant.not_ready_to_harvest',
        ),
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
    name: 'a manual task completed yesterday does NOT silence the check — equivalence must be provable',
    reviewNotes:
      'Identical to the fixture above except the completed task carries no originating rule ' +
      'key, which is what every manually created task looks like. Its free-text title cannot ' +
      'be shown to mean "I watered this", so it suppresses nothing and the check fires ' +
      'normally. Treating it as equivalent would silently withhold care on the strength of a ' +
      'guess.',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact(),
      recentPrecipitation: rainlessWeek(),
      completedTasks: [
        {
          taskId: TASK_B_ID,
          target: plantTarget(PLANT_A_ID),
          originRuleKey: null,
          completedAt: new Date(FIXTURE_NOW.getTime() - 24 * HOUR_MS),
        },
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        fireDecision(
          'watering.dry-spell-check',
          PLANT_A_ID,
          85,
          null,
          ACTIVE_WATERING_RULE_VERSION,
        ),
        notEligibleDecision(
          'observation.routine-check-reminder',
          PLANT_A_ID,
          'plant.recently_observed',
        ),
        notEligibleDecision(
          'lifecycle.harvest-readiness-check',
          PLANT_A_ID,
          'plant.not_ready_to_harvest',
        ),
        ruleSkippedDecision('weather.frost-watch', {
          kind: 'weatherMissing',
          requiredKind: 'forecast',
        }),
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [wateringCandidateForPlantA()],
    },
  },
];
