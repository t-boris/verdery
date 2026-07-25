/**
 * Fixtures for `watering.dry-spell-check` v1 — see README.md for how to
 * review. Covers: firing on a fresh warm dry reading, the labeled
 * reduced-confidence firing on a STALE reading, the below-threshold skip,
 * the missing-measurement skip (nothing invented), and the
 * dormant-plant eligibility miss.
 */

import type { PlannedCandidate } from '../../src/modules/tasks-recommendations/public.js';
import type { RuleFixture } from './fixture-support.js';
import {
  FIXTURE_NOW,
  HOUR_MS,
  PLANT_A_ID,
  WEATHER_OBSERVATION_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  ruleSkippedDecision,
  weatherObservationFact,
} from './fixture-support.js';

/** The expected candidate for PLANT_A in the standard 27 °C / 0 mm reading, parameterized by freshness only. */
function wateringCandidate(freshness: 'fresh' | 'stale'): PlannedCandidate {
  return {
    ruleKey: 'watering.dry-spell-check',
    ruleVersion: 1,
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
        factKey: 'weather.dry_spell_observation',
        factValue: {
          temperatureCelsius: 27,
          precipitationMm: 0,
          freshness,
          effectiveAt: '2026-07-25T08:30:00.000Z',
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
        contribution: 25,
        basis: { temperatureCelsius: 27, precipitationMm: 0 },
      },
      { kind: 'plant_impact', contribution: 15, basis: { lifecycleStage: 'growing' } },
      {
        kind: 'confidence',
        contribution: freshness === 'fresh' ? 20 : 8,
        basis: { weatherFreshness: freshness },
      },
    ],
    priorityScore: freshness === 'fresh' ? 80 : 68,
    explanation:
      'Recent weather at this garden was warm (27 °C) with almost no rain (0 mm). Cherry ' +
      'tomato is in its growing stage, so check whether it needs watering.',
    supersedes: null,
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
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        fireDecision('watering.dry-spell-check', PLANT_A_ID, 80),
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
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        fireDecision('watering.dry-spell-check', PLANT_A_ID, 68),
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
      ],
      plannedCandidates: [wateringCandidate('stale')],
    },
  },
  {
    name: 'skips when the weather does not indicate a warm dry spell',
    reviewNotes:
      'An 18 °C reading with 0 mm precipitation is below the hot-day threshold, so the whole ' +
      'rule skips with a typed reason and no candidate exists. Review: should a cool dry day ' +
      'ever prompt a watering check?',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact({
        measurements: {
          temperatureCelsius: 18,
          precipitationMm: 0,
          windSpeedMps: null,
          humidityPercent: null,
        },
      }),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ruleSkippedDecision('watering.dry-spell-check', {
          kind: 'factMissing',
          detail: 'Current weather does not indicate a warm dry spell.',
        }),
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
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'skips when a needed measurement is absent — the missing fact is never invented',
    reviewNotes:
      'The weather record exists and is fresh and warm, but its precipitation measurement is ' +
      'null (the provider did not report one). The rule needs both measurements, so it skips ' +
      'with a typed missing-fact reason. Nothing substitutes a guessed precipitation value — ' +
      'the phase exit criterion in fixture form.',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID })],
      weatherObservation: weatherObservationFact({
        measurements: {
          temperatureCelsius: 27,
          precipitationMm: null,
          windSpeedMps: null,
          humidityPercent: null,
        },
      }),
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ruleSkippedDecision('watering.dry-spell-check', {
          kind: 'factMissing',
          detail:
            'The latest weather observation lacks a temperature or precipitation measurement.',
        }),
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
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        notEligibleDecision('watering.dry-spell-check', PLANT_A_ID, 'plant.status_not_active'),
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
      ],
      plannedCandidates: [],
    },
  },
];
