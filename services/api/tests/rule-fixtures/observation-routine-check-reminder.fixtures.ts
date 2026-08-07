/**
 * Fixtures for `observation.routine-check-reminder` v1 — see README.md
 * for how to review. Covers: firing measured from the latest observation
 * (with that observation pinned as evidence), firing for a never-observed
 * plant measured from its creation (no observation reference invented),
 * and the recently-observed eligibility miss.
 */

import type { RuleFixture } from './fixture-support.js';
import {
  ACTIVE_WATERING_RULE_VERSION,
  DAY_MS,
  FIXTURE_NOW,
  OBSERVATION_ID,
  PLANT_A_ID,
  SEASONAL_RULES_HEMISPHERE_SKIPS,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  ruleSkippedDecision,
} from './fixture-support.js';

const BOTH_WEATHER_RULES_SKIP = [
  ruleSkippedDecision(
    'watering.dry-spell-check',
    { kind: 'weatherMissing', requiredKind: 'observation' },
    ACTIVE_WATERING_RULE_VERSION,
  ),
  ruleSkippedDecision('weather.frost-watch', {
    kind: 'weatherMissing',
    requiredKind: 'forecast',
  }),
] as const;

const SIXTEEN_DAYS_AGO = new Date(FIXTURE_NOW.getTime() - 16 * DAY_MS);
const TWENTY_DAYS_AGO = new Date(FIXTURE_NOW.getTime() - 20 * DAY_MS);

export const observationRoutineCheckReminderFixtures: readonly RuleFixture[] = [
  {
    name: 'reminds after 16 unobserved days, pinning the last observation as evidence',
    reviewNotes:
      'The plant’s latest observation is 16 days old (past the 14-day cadence). Expected: one ' +
      'low-urgency reminder at priority 40 whose evidence carries BOTH the derived recency ' +
      'fact and a reference to the exact observation the interval was measured from. Review: ' +
      'is a 14-day check cadence sensible as a default?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID, createdAt: TWENTY_DAYS_AGO })],
      observations: [
        { observationId: OBSERVATION_ID, plantId: PLANT_A_ID, observedAt: SIXTEEN_DAYS_AGO },
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
        fireDecision('observation.routine-check-reminder', PLANT_A_ID, 40),
        notEligibleDecision(
          'lifecycle.harvest-readiness-check',
          PLANT_A_ID,
          'plant.not_ready_to_harvest',
        ),
        BOTH_WEATHER_RULES_SKIP[1],
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [
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
              factValue: {
                lastObservedAt: SIXTEEN_DAYS_AGO.toISOString(),
                baseline: 'latest_observation',
                daysSince: 16,
              },
            },
            {
              kind: 'observation',
              sourceObservationId: OBSERVATION_ID,
              sourceTaskId: null,
              sourcePlantId: null,
              sourceWeatherRecordId: null,
              factKey: 'observation.latest_for_plant',
              factValue: { observedAt: SIXTEEN_DAYS_AGO.toISOString() },
            },
          ],
          factors: [
            {
              kind: 'urgency_window',
              contribution: 10,
              basis: { urgency: 'low', validityWindowDays: 7 },
            },
            { kind: 'plant_impact', contribution: 10, basis: { lifecycleStage: 'growing' } },
            {
              kind: 'confidence',
              contribution: 20,
              basis: { source: 'own_records', daysSince: 16 },
            },
          ],
          priorityScore: 40,
          explanation:
            'Cherry tomato has not been observed for 16 days. Record a quick check of its ' +
            'condition.',
          supersedesCandidateId: null,
          supersedesLiveCandidate: null,
        },
      ],
    },
  },
  {
    name: 'reminds for a never-observed plant measured from its creation — no observation reference invented',
    reviewNotes:
      'The plant was added 20 days ago and never observed. The reminder fires, its recency ' +
      'fact says the baseline is the plant’s creation with lastObservedAt null, and there is ' +
      'NO observation evidence row — an absent record is never fabricated. Review: is ' +
      'measuring from creation the right behavior for a never-observed plant?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID, createdAt: TWENTY_DAYS_AGO })],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
        fireDecision('observation.routine-check-reminder', PLANT_A_ID, 40),
        notEligibleDecision(
          'lifecycle.harvest-readiness-check',
          PLANT_A_ID,
          'plant.not_ready_to_harvest',
        ),
        BOTH_WEATHER_RULES_SKIP[1],
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [
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
              factValue: {
                lastObservedAt: null,
                baseline: 'plant_created_at',
                daysSince: 20,
              },
            },
          ],
          factors: [
            {
              kind: 'urgency_window',
              contribution: 10,
              basis: { urgency: 'low', validityWindowDays: 7 },
            },
            { kind: 'plant_impact', contribution: 10, basis: { lifecycleStage: 'growing' } },
            {
              kind: 'confidence',
              contribution: 20,
              basis: { source: 'own_records', daysSince: 20 },
            },
          ],
          priorityScore: 40,
          explanation:
            'Cherry tomato has not been observed for 20 days. Record a quick check of its ' +
            'condition.',
          supersedesCandidateId: null,
          supersedesLiveCandidate: null,
        },
      ],
    },
  },
  {
    name: 'stays quiet for a recently observed plant',
    reviewNotes:
      'The plant was observed 5 days ago — inside the 14-day cadence — so the reminder ' +
      'reports not-eligible and nothing fires anywhere.',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID, createdAt: TWENTY_DAYS_AGO })],
      observations: [
        {
          observationId: OBSERVATION_ID,
          plantId: PLANT_A_ID,
          observedAt: new Date(FIXTURE_NOW.getTime() - 5 * DAY_MS),
        },
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
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
        BOTH_WEATHER_RULES_SKIP[1],
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'contradictory facts: a future-dated observation suppresses the reminder instead of inventing an interval',
    reviewNotes:
      'P7-QA-01 contradictory-fact case. The plant’s latest observation is timestamped twenty ' +
      'days AFTER the evaluation instant — a record that contradicts the clock (client clock ' +
      'skew or a user-edited timestamp), far enough out that a sign-blind interval would read ' +
      'as twenty overdue days. The engine measures the interval honestly from the real record, ' +
      'gets a NEGATIVE day count, and reports not-eligible — it neither invents an overdue ' +
      'interval nor clamps the contradictory timestamp to something more plausible. Review: is ' +
      'silent suppression the right posture for a future-dated observation, or should such ' +
      'records be surfaced to the user elsewhere?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID, createdAt: TWENTY_DAYS_AGO })],
      observations: [
        {
          observationId: OBSERVATION_ID,
          plantId: PLANT_A_ID,
          observedAt: new Date(FIXTURE_NOW.getTime() + 20 * DAY_MS),
        },
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        BOTH_WEATHER_RULES_SKIP[0],
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
        BOTH_WEATHER_RULES_SKIP[1],
        ...SEASONAL_RULES_HEMISPHERE_SKIPS,
      ],
      plannedCandidates: [],
    },
  },
];
