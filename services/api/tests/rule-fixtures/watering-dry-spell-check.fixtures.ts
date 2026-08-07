/**
 * Fixtures for `watering.dry-spell-check` **v2** — see README.md for how to
 * review.
 *
 * v2 decides on rainfall ACCUMULATED across elapsed days rather than on one
 * latest precipitation figure, which for the selected provider is the
 * preceding hour. An hour of calm is not a dry spell, and an hour of rain
 * does not water a garden; the accumulation is the question a gardener
 * actually asks. v1 remains shipped and renderable but is no longer
 * evaluated, so these fixtures describe v2.
 *
 * Covers: firing on a warm reading over a rainless week, the labeled
 * reduced-confidence firing on a STALE reading, the adequate-rainfall skip,
 * the too-little-history skip (a short window is not evidence of drought),
 * the no-history-at-all skip (unknown is never read as dry), and the
 * dormant-plant eligibility miss.
 */

import type { PlannedCandidate } from '../../src/modules/tasks-recommendations/public.js';
import type { RuleFixture } from './fixture-support.js';
import {
  ACTIVE_WATERING_RULE_VERSION,
  FIXTURE_NOW,
  HOUR_MS,
  PLANT_A_ID,
  SEASONAL_RULES_HEMISPHERE_SKIPS,
  WEATHER_OBSERVATION_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  precipitationWindow,
  rainlessWeek,
  ruleSkippedDecision,
  weatherObservationFact,
} from './fixture-support.js';

/** The expected candidate for PLANT_A in the standard 27 °C reading over a rainless week, parameterized by freshness only. */
function wateringCandidate(freshness: 'fresh' | 'stale'): PlannedCandidate {
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
          freshness,
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
        contribution: freshness === 'fresh' ? 20 : 8,
        basis: { weatherFreshness: freshness, daysCovered: 7 },
      },
    ],
    priorityScore: freshness === 'fresh' ? 85 : 73,
    explanation:
      'This garden has had 0 mm of rain over the last 7 days — about 25 mm less than the ' +
      'window usually supplies — and the latest reading is 27 °C. Cherry tomato is in its ' +
      'growing stage, so check whether it needs watering.',
    supersedesCandidateId: null,
    supersedesLiveCandidate: null,
  };
}

export const wateringDrySpellCheckFixtures: readonly RuleFixture[] = [
  {
    name: 'fires a watering check for an actively growing plant on a fresh warm dry reading',
    reviewNotes:
      'One active plant in the growing stage; the latest weather observation is FRESH, 27 °C ' +
      'with 0 mm precipitation. Expected: exactly one watering-check candidate at priority 80 ' +
      'with the weather record and the lifecycle stage as evidence, and the explanation quoting ' +
      'both measurements. Review: are 24 °C / 0.5 mm sensible dry-spell thresholds, and are the ' +
      'five active-growth stages the right eligibility set?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact(),
      recentPrecipitation: rainlessWeek(),
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
      plannedCandidates: [wateringCandidate('fresh')],
    },
  },
  {
    name: 'still fires on a STALE reading, explicitly labeled, with reduced confidence',
    reviewNotes:
      'Same garden, but the weather observation is past its freshness window. The rule’s ' +
      'declared stale policy permits use, so the candidate fires at priority 68 (confidence ' +
      'drops 20 → 8) and BOTH the evidence row and the confidence factor carry the ' +
      '‘stale’ label — stale data is used only labeled, never silently. Review: is ' +
      'firing on stale data acceptable for a low-stakes watering check?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact({ freshness: 'stale' }),
      recentPrecipitation: rainlessWeek(),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        fireDecision(
          'watering.dry-spell-check',
          PLANT_A_ID,
          73,
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
      plannedCandidates: [wateringCandidate('stale')],
    },
  },
  {
    name: 'skips when the week supplied enough rain, however dry the last hour was',
    reviewNotes:
      'A rainless CURRENT reading, but 20 mm fell across the week — above the 12.5 mm ' +
      'deficit threshold. v1 would have fired here purely because the latest hourly figure ' +
      'was 0 mm; v2 does not, which is the whole point of the version. Review: is half the ' +
      'reference weekly supply the right line to call a garden short of water?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact(),
      recentPrecipitation: precipitationWindow([0, 0, 12, 0, 8, 0, 0]),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ruleSkippedDecision(
          'watering.dry-spell-check',
          {
            kind: 'factMissing',
            detail: 'Recent rainfall is close enough to what this window normally supplies.',
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
    name: 'skips when the garden has no measured rainfall history — unknown is never read as dry',
    reviewNotes:
      'A fresh, warm weather reading, but this garden has no elapsed daily rainfall at all ' +
      '(no provider, no coordinates, or nothing fetched yet). The rule refuses to call that a ' +
      'dry spell. This is the phase exit criterion in fixture form: an absent measurement is ' +
      'never substituted with zero, because "no rain fell" and "we did not measure" lead to ' +
      'opposite actions.',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact(),
      recentPrecipitation: null,
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ruleSkippedDecision(
          'watering.dry-spell-check',
          {
            kind: 'factMissing',
            detail: 'This garden has no measured rainfall history to accumulate.',
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
    name: 'does not target a dormant plant, even in a dry spell',
    reviewNotes:
      'The garden’s only plant is dormant. Every plant-targeted rule reports a ' +
      'not-eligible decision for it, and nothing fires. Review: is excluding dormant plants ' +
      'from watering checks correct?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID, status: 'dormant' })],
      weatherObservation: weatherObservationFact(),
      recentPrecipitation: rainlessWeek(),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        notEligibleDecision(
          'watering.dry-spell-check',
          PLANT_A_ID,
          'plant.status_not_active',
          ACTIVE_WATERING_RULE_VERSION,
        ),
        notEligibleDecision(
          'observation.routine-check-reminder',
          PLANT_A_ID,
          'plant.status_not_active',
        ),
        notEligibleDecision(
          'lifecycle.harvest-readiness-check',
          PLANT_A_ID,
          'plant.status_not_active',
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
];
