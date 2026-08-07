/**
 * Fixtures for `succession.replanting-reminder` v1 (P9D-SEASON-RULES-01)
 * — see README.md for how to review. Covers: firing on a taxon with a
 * reviewed `successionIntervalDays`, the engine's OWN recurrence
 * mechanism spacing re-fires (the rule's own header explains why this is
 * a garden-wide fallback cadence, not literally the per-taxon interval),
 * the whole-rule hemisphere skip, the honest skip when only an
 * `awaiting_horticultural_review` fact exists, and the skip when no
 * succession interval is configured at all.
 */

import type { PlannedCandidate } from '../../src/modules/tasks-recommendations/public.js';
import type { RuleFixture } from './fixture-support.js';
import {
  ACTIVE_WATERING_RULE_VERSION,
  DAY_MS,
  FIXTURE_NOW,
  PLANT_A_ID,
  PRIOR_CANDIDATE_A_ID,
  SEASONAL_RULES_HEMISPHERE_SKIPS,
  TAXONOMY_A_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  priorCandidate,
  reviewedSeasonalFact,
  ruleSkippedDecision,
  suppressedDecision,
  taxonomyFact,
} from './fixture-support.js';

const ORIGINAL_FOUR_RULES_QUIET = [
  ruleSkippedDecision(
    'watering.dry-spell-check',
    { kind: 'weatherMissing', requiredKind: 'observation' },
    ACTIVE_WATERING_RULE_VERSION,
  ),
  notEligibleDecision('observation.routine-check-reminder', PLANT_A_ID, 'plant.recently_observed'),
  notEligibleDecision(
    'lifecycle.harvest-readiness-check',
    PLANT_A_ID,
    'plant.not_ready_to_harvest',
  ),
  ruleSkippedDecision('weather.frost-watch', { kind: 'weatherMissing', requiredKind: 'forecast' }),
] as const;

const SOWING_NOT_CONFIGURED = notEligibleDecision(
  'seasonal.sowing-window-check',
  PLANT_A_ID,
  'taxonomy.no_sowing_windows_configured',
);
const ROTATION_NOT_CONFIGURED = notEligibleDecision(
  'rotation.crop-rotation-caution',
  PLANT_A_ID,
  'taxonomy.rotation_rest_period_not_configured',
);

const PLANT_WITH_TAXONOMY = plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID });
const TAXONOMY_FACTS_WITH_SUCCESSION = [
  taxonomyFact({ seasonalFact: reviewedSeasonalFact({ successionIntervalDays: 14 }) }),
];

function successionCandidate(supersedesCandidateId: string | null = null): PlannedCandidate {
  return {
    ruleKey: 'succession.replanting-reminder',
    ruleVersion: 1,
    safetyTier: 'ordinary_care',
    careCategory: 'succession_planting',
    target: plantTarget(PLANT_A_ID),
    urgency: 'normal',
    windowStart: FIXTURE_NOW,
    windowEnd: new Date(FIXTURE_NOW.getTime() + 10 * DAY_MS),
    evidence: [
      {
        kind: 'plant_identity',
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: PLANT_A_ID,
        sourceWeatherRecordId: null,
        factKey: 'plant.identity',
        factValue: { taxonomyReferenceId: TAXONOMY_A_ID },
      },
      {
        kind: 'seasonal_calendar',
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: null,
        sourceWeatherRecordId: null,
        factKey: 'taxonomy.succession_interval',
        factValue: {
          taxonomyReferenceId: TAXONOMY_A_ID,
          hemisphere: 'northern',
          successionIntervalDays: 14,
        },
      },
    ],
    factors: [
      {
        kind: 'urgency_window',
        contribution: 15,
        basis: { urgency: 'normal', validityWindowDays: 10 },
      },
      {
        kind: 'seasonal_constraint',
        contribution: 20,
        basis: { hemisphere: 'northern', successionIntervalDays: 14 },
      },
      { kind: 'plant_impact', contribution: 10, basis: { lifecycleStage: 'growing' } },
      {
        kind: 'confidence',
        contribution: 15,
        basis: { source: 'horticulturally_reviewed_seasonal_fact' },
      },
    ],
    priorityScore: 60,
    explanation:
      'Cherry tomato benefits from succession sowing roughly every 14 days. Consider sowing a ' +
      'new batch now.',
    supersedesCandidateId,
    supersedesLiveCandidate: null,
  };
}

export const successionReplantingReminderFixtures: readonly RuleFixture[] = [
  {
    name: 'fires a succession reminder for a taxon with a reviewed successionIntervalDays',
    reviewNotes:
      'A reviewed fact configures a 14-day succession interval; the plant has no prior ' +
      "candidate at all, so the engine's own recurrence gate never applies. Priority 60. Review: " +
      'is 10 days a sensible validity window for a succession nudge?',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_SUCCESSION,
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        fireDecision('succession.replanting-reminder', PLANT_A_ID, 60),
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [successionCandidate()],
    },
  },
  {
    name: 'recurrence suppression: a resolved candidate 10 days ago blocks regeneration inside the fallback cadence',
    reviewNotes:
      'The engine\'s own recurrence mechanism (this rule header, "RECURRENCE DESIGN DECISION") ' +
      "spaces re-fires using the rule's own static `recurrenceIntervalDaysFallback` (21 days) — " +
      "a garden-wide placeholder, not literally the taxon's own 14-day succession interval, " +
      "since the engine's own timing field cannot vary per target. Review: is 21 days an " +
      'acceptable fallback cadence given the real interval is quoted honestly in the ' +
      'explanation instead?',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_SUCCESSION,
    }),
    prior: {
      liveCandidates: [],
      latestPerRuleAndTarget: [
        priorCandidate({
          candidateId: PRIOR_CANDIDATE_A_ID,
          ruleKey: 'succession.replanting-reminder',
          state: 'completed',
          revision: 2,
          createdAt: new Date(FIXTURE_NOW.getTime() - 10 * DAY_MS),
        }),
      ],
    },
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        suppressedDecision('succession.replanting-reminder', PLANT_A_ID, {
          kind: 'withinRecurrenceInterval',
          priorCandidateId: PRIOR_CANDIDATE_A_ID,
          priorCreatedAt: new Date(FIXTURE_NOW.getTime() - 10 * DAY_MS),
        }),
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'fires again once the fallback recurrence interval has fully elapsed',
    reviewNotes:
      'Same taxon and prior candidate shape, but the resolved candidate is 22 days old — past ' +
      'the 21-day fallback — so a fresh reminder fires with no supersession link.',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_SUCCESSION,
    }),
    prior: {
      liveCandidates: [],
      latestPerRuleAndTarget: [
        priorCandidate({
          candidateId: PRIOR_CANDIDATE_A_ID,
          ruleKey: 'succession.replanting-reminder',
          state: 'completed',
          revision: 2,
          createdAt: new Date(FIXTURE_NOW.getTime() - 22 * DAY_MS),
        }),
      ],
    },
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        fireDecision('succession.replanting-reminder', PLANT_A_ID, 60),
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [successionCandidate()],
    },
  },
  {
    name: 'whole-rule skip: the garden has never been georeferenced (hemisphere unknown)',
    reviewNotes:
      'Same taxon and a real configured succession interval, but the garden itself has no ' +
      'known hemisphere — all three seasonal rules skip identically.',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      taxonomyFacts: TAXONOMY_FACTS_WITH_SUCCESSION,
    }),
    prior: noPrior(),
    expected: {
      decisions: [...ORIGINAL_FOUR_RULES_QUIET, ...SEASONAL_RULES_HEMISPHERE_SKIPS],
      plannedCandidates: [],
    },
  },
  {
    name: 'honest skip: only an awaiting_horticultural_review fact exists for this taxon',
    reviewNotes:
      '`TaxonomyFact.seasonalFact` is `null` — the only row for this taxon is still ' +
      '`awaiting_horticultural_review` (or absent entirely). No succession cadence is invented ' +
      'from an unreviewed row.',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: [taxonomyFact({ seasonalFact: null })],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        notEligibleDecision(
          'seasonal.sowing-window-check',
          PLANT_A_ID,
          'taxonomy.seasonal_fact_not_reviewed',
        ),
        notEligibleDecision(
          'succession.replanting-reminder',
          PLANT_A_ID,
          'taxonomy.seasonal_fact_not_reviewed',
        ),
        notEligibleDecision(
          'rotation.crop-rotation-caution',
          PLANT_A_ID,
          'taxonomy.seasonal_fact_not_reviewed',
        ),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'stays quiet when the reviewed fact has no configured succession interval',
    reviewNotes:
      'A reviewed fact exists (most crops have no succession benefit — a legitimate row), but ' +
      '`successionIntervalDays` is null. No cadence is guessed in its place.',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: [taxonomyFact({ seasonalFact: reviewedSeasonalFact() })],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        notEligibleDecision(
          'succession.replanting-reminder',
          PLANT_A_ID,
          'taxonomy.succession_interval_not_configured',
        ),
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [],
    },
  },
];
