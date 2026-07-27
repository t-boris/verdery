/**
 * Fixtures for `rotation.crop-rotation-caution` v1 (P9D-SEASON-RULES-01)
 * — see README.md for how to review. Covers: firing when the same family
 * grew in the bed inside the reviewed rest period, staying quiet once
 * that rest period has fully elapsed, staying quiet on a DIFFERENT prior
 * family, no known prior occupant at all, no bed placement, no
 * configured rest period, the whole-rule hemisphere skip, and the honest
 * skip when only an `awaiting_horticultural_review` fact exists.
 */

import type { RuleFixture } from './fixture-support.js';
import {
  DAY_MS,
  FIXTURE_NOW,
  GARDEN_AREA_A_ID,
  PLANT_A_ID,
  SEASONAL_RULES_HEMISPHERE_SKIPS,
  TAXONOMY_A_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  priorBedOccupant,
  reviewedSeasonalFact,
  ruleSkippedDecision,
  taxonomyFact,
} from './fixture-support.js';

const ORIGINAL_FOUR_RULES_QUIET = [
  ruleSkippedDecision('watering.dry-spell-check', {
    kind: 'weatherMissing',
    requiredKind: 'observation',
  }),
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
const SUCCESSION_NOT_CONFIGURED = notEligibleDecision(
  'succession.replanting-reminder',
  PLANT_A_ID,
  'taxonomy.succession_interval_not_configured',
);

const PLACED_PLANT = plantFact({
  plantId: PLANT_A_ID,
  taxonomyReferenceId: TAXONOMY_A_ID,
  gardenAreaMapObjectId: GARDEN_AREA_A_ID,
});
const TAXONOMY_FACTS_WITH_ROTATION_REST = [
  taxonomyFact({ seasonalFact: reviewedSeasonalFact({ rotationRestSeasons: 2 }) }),
];

export const cropRotationCautionFixtures: readonly RuleFixture[] = [
  {
    name: 'fires when the bed most recently grew the SAME family inside the reviewed rest period',
    reviewNotes:
      'The reviewed fact configures a 2-season (730-day) rest period; the bed most recently ' +
      'grew the same family (Solanaceae) 200 days ago — well inside it. Priority 65. Review: ' +
      'is one rotation season == one year a sensible reading given this codebase has no other ' +
      "season-length concept (see the rule file's own header)?",
    facts: gardenFacts({
      plants: [PLACED_PLANT],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_ROTATION_REST,
      priorBedOccupants: [
        priorBedOccupant({
          plantId: PLANT_A_ID,
          gardenAreaMapObjectId: GARDEN_AREA_A_ID,
          priorFamily: 'Solanaceae',
          priorOccupancyEndedAt: new Date(FIXTURE_NOW.getTime() - 200 * DAY_MS),
        }),
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        SUCCESSION_NOT_CONFIGURED,
        fireDecision('rotation.crop-rotation-caution', PLANT_A_ID, 65),
      ],
      plannedCandidates: [
        {
          ruleKey: 'rotation.crop-rotation-caution',
          ruleVersion: 1,
          safetyTier: 'ordinary_care',
          careCategory: 'crop_rotation',
          target: plantTarget(PLANT_A_ID),
          urgency: 'normal',
          windowStart: FIXTURE_NOW,
          windowEnd: new Date(FIXTURE_NOW.getTime() + 21 * DAY_MS),
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
              factKey: 'bed.rotation_conflict',
              factValue: {
                taxonomyReferenceId: TAXONOMY_A_ID,
                hemisphere: 'northern',
                family: 'Solanaceae',
                rotationRestSeasons: 2,
                priorFamily: 'Solanaceae',
                priorOccupancyEndedAt: new Date(FIXTURE_NOW.getTime() - 200 * DAY_MS).toISOString(),
                elapsedDays: 200,
              },
            },
          ],
          factors: [
            {
              kind: 'urgency_window',
              contribution: 15,
              basis: { urgency: 'normal', validityWindowDays: 21 },
            },
            {
              kind: 'seasonal_constraint',
              contribution: 20,
              basis: { hemisphere: 'northern', rotationRestSeasons: 2, elapsedDays: 200 },
            },
            { kind: 'plant_impact', contribution: 15, basis: { family: 'Solanaceae' } },
            {
              kind: 'confidence',
              contribution: 15,
              basis: { source: 'bed_occupancy_history_and_reviewed_seasonal_fact' },
            },
          ],
          priorityScore: 65,
          explanation:
            'Cherry tomato is planted in a bed that most recently grew the same family ' +
            '(Solanaceae) 200 days ago, inside the recommended 2-season rest period. Consider ' +
            'a different bed or family next time.',
          supersedesCandidateId: null,
          supersedesLiveCandidate: null,
        },
      ],
    },
  },
  {
    name: 'stays quiet once the reviewed rest period has fully elapsed',
    reviewNotes:
      'Same family, same bed, but the prior occupant left 800 days ago — past the 730-day ' +
      '(2-season) rest period, so no caution is raised.',
    facts: gardenFacts({
      plants: [PLACED_PLANT],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_ROTATION_REST,
      priorBedOccupants: [
        priorBedOccupant({
          plantId: PLANT_A_ID,
          gardenAreaMapObjectId: GARDEN_AREA_A_ID,
          priorFamily: 'Solanaceae',
          priorOccupancyEndedAt: new Date(FIXTURE_NOW.getTime() - 800 * DAY_MS),
        }),
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        SUCCESSION_NOT_CONFIGURED,
        notEligibleDecision(
          'rotation.crop-rotation-caution',
          PLANT_A_ID,
          'bed.rotation_rest_period_elapsed',
        ),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'stays quiet when the bed most recently grew a DIFFERENT family',
    reviewNotes:
      'The prior occupant left recently, but it was a different botanical family — no known ' +
      "conflict for THIS plant's own family.",
    facts: gardenFacts({
      plants: [PLACED_PLANT],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_ROTATION_REST,
      priorBedOccupants: [
        priorBedOccupant({
          plantId: PLANT_A_ID,
          gardenAreaMapObjectId: GARDEN_AREA_A_ID,
          priorFamily: 'Brassicaceae',
          priorOccupancyEndedAt: new Date(FIXTURE_NOW.getTime() - 200 * DAY_MS),
        }),
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        SUCCESSION_NOT_CONFIGURED,
        notEligibleDecision(
          'rotation.crop-rotation-caution',
          PLANT_A_ID,
          'bed.prior_occupant_different_family',
        ),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'stays quiet when the bed has no known prior occupant in the lookback window',
    reviewNotes:
      'A new bed, or one whose entire history predates the lookback window — no known ' +
      'conflict, so no caution is raised. Never fabricated from an absent history.',
    facts: gardenFacts({
      plants: [PLACED_PLANT],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_ROTATION_REST,
      priorBedOccupants: [],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        SUCCESSION_NOT_CONFIGURED,
        notEligibleDecision(
          'rotation.crop-rotation-caution',
          PLANT_A_ID,
          'bed.no_prior_occupant_conflict',
        ),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'stays quiet when the plant itself has no bed placement',
    reviewNotes: 'A rotation caution cannot be raised about a bed the plant does not occupy.',
    facts: gardenFacts({
      plants: [plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID })],
      hemisphere: 'northern',
      taxonomyFacts: TAXONOMY_FACTS_WITH_ROTATION_REST,
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        SUCCESSION_NOT_CONFIGURED,
        notEligibleDecision('rotation.crop-rotation-caution', PLANT_A_ID, 'plant.not_placed'),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'stays quiet when the reviewed fact has no configured rotation rest period',
    reviewNotes:
      "No known conflict threshold means no caution to raise — this stage's own brief, taken " +
      'literally: `rotationRestSeasons` null is not treated as "always caution" or "never".',
    facts: gardenFacts({
      plants: [PLACED_PLANT],
      hemisphere: 'northern',
      taxonomyFacts: [taxonomyFact({ seasonalFact: reviewedSeasonalFact() })],
      priorBedOccupants: [
        priorBedOccupant({
          plantId: PLANT_A_ID,
          gardenAreaMapObjectId: GARDEN_AREA_A_ID,
          priorFamily: 'Solanaceae',
          priorOccupancyEndedAt: new Date(FIXTURE_NOW.getTime() - 200 * DAY_MS),
        }),
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        SOWING_NOT_CONFIGURED,
        SUCCESSION_NOT_CONFIGURED,
        notEligibleDecision(
          'rotation.crop-rotation-caution',
          PLANT_A_ID,
          'taxonomy.rotation_rest_period_not_configured',
        ),
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'whole-rule skip: the garden has never been georeferenced (hemisphere unknown)',
    reviewNotes:
      'Same taxon, placement, and prior-occupant conflict, but the garden itself has no known ' +
      'hemisphere — all three seasonal rules skip identically.',
    facts: gardenFacts({
      plants: [PLACED_PLANT],
      taxonomyFacts: TAXONOMY_FACTS_WITH_ROTATION_REST,
      priorBedOccupants: [
        priorBedOccupant({
          plantId: PLANT_A_ID,
          gardenAreaMapObjectId: GARDEN_AREA_A_ID,
          priorFamily: 'Solanaceae',
          priorOccupancyEndedAt: new Date(FIXTURE_NOW.getTime() - 200 * DAY_MS),
        }),
      ],
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
      '`TaxonomyFact.seasonalFact` is `null` — no rest period is invented from an unreviewed ' +
      'row, even with a real same-family prior occupant on record.',
    facts: gardenFacts({
      plants: [PLACED_PLANT],
      hemisphere: 'northern',
      taxonomyFacts: [taxonomyFact({ seasonalFact: null })],
      priorBedOccupants: [
        priorBedOccupant({
          plantId: PLANT_A_ID,
          gardenAreaMapObjectId: GARDEN_AREA_A_ID,
          priorFamily: 'Solanaceae',
          priorOccupancyEndedAt: new Date(FIXTURE_NOW.getTime() - 200 * DAY_MS),
        }),
      ],
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
];
