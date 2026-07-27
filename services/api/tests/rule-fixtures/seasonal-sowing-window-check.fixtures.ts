/**
 * Fixtures for `seasonal.sowing-window-check` v1 (P9D-SEASON-RULES-01) —
 * see README.md for how to review. Covers: firing WITHIN a configured
 * window, firing while APPROACHING one, the month-WRAPAROUND case
 * (a November-February window, evaluated in January) this stage's own
 * brief calls out by name, the whole-rule skip on an unknown hemisphere,
 * the honest skip when only an `awaiting_horticultural_review` fact
 * exists, unconfigured windows, and the outside-and-not-approaching miss.
 *
 * Every scenario also pins `succession.replanting-reminder`'s and
 * `rotation.crop-rotation-caution`'s own decisions for the SAME facts —
 * unavoidable, since the full catalog runs on every fixture — which
 * incidentally cross-checks that the three seasonal rules read the shared
 * `TaxonomyFact`/hemisphere gate consistently.
 */

import type { RuleFixture } from './fixture-support.js';
import {
  DAY_MS,
  FIXTURE_NOW,
  PLANT_A_ID,
  SEASONAL_RULES_HEMISPHERE_SKIPS,
  TAXONOMY_A_ID,
  fireDecision,
  gardenFacts,
  noPrior,
  notEligibleDecision,
  plantFact,
  plantTarget,
  reviewedSeasonalFact,
  ruleSkippedDecision,
  taxonomyFact,
} from './fixture-support.js';

/** The four original launch rules' own decisions for one active, recently-added, `growing`-stage plant with no weather configured — identical across every scenario below that keeps `evaluatedAt`/`plant.createdAt` at their fixture defaults. */
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

const SUCCESSION_NOT_CONFIGURED = notEligibleDecision(
  'succession.replanting-reminder',
  PLANT_A_ID,
  'taxonomy.succession_interval_not_configured',
);
const ROTATION_NOT_CONFIGURED = notEligibleDecision(
  'rotation.crop-rotation-caution',
  PLANT_A_ID,
  'taxonomy.rotation_rest_period_not_configured',
);

const PLANT_WITH_TAXONOMY = plantFact({ plantId: PLANT_A_ID, taxonomyReferenceId: TAXONOMY_A_ID });

function sowingCandidate(options: {
  readonly windowKind: 'sow_indoors' | 'sow_outdoors' | 'transplant';
  readonly windowKindLabel: string;
  readonly startMonth: number;
  readonly endMonth: number;
  readonly windowRange: string;
  readonly status: 'within' | 'approaching';
  readonly daysUntilStart: number;
  readonly evaluatedAt: Date;
}) {
  return {
    ruleKey: 'seasonal.sowing-window-check',
    ruleVersion: 1,
    safetyTier: 'ordinary_care' as const,
    careCategory: 'sowing',
    target: plantTarget(PLANT_A_ID),
    urgency: 'normal' as const,
    windowStart: options.evaluatedAt,
    windowEnd: new Date(options.evaluatedAt.getTime() + 14 * DAY_MS),
    evidence: [
      {
        kind: 'plant_identity' as const,
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: PLANT_A_ID,
        sourceWeatherRecordId: null,
        factKey: 'plant.identity',
        factValue: { taxonomyReferenceId: TAXONOMY_A_ID },
      },
      {
        kind: 'seasonal_calendar' as const,
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: null,
        sourceWeatherRecordId: null,
        factKey: 'taxonomy.sowing_window',
        factValue: {
          taxonomyReferenceId: TAXONOMY_A_ID,
          hemisphere: 'northern',
          windowKind: options.windowKind,
          startMonth: options.startMonth,
          endMonth: options.endMonth,
          status: options.status,
          daysUntilStart: options.daysUntilStart,
        },
      },
    ],
    factors: [
      {
        kind: 'urgency_window' as const,
        contribution: 15,
        basis: { urgency: 'normal', validityWindowDays: 14 },
      },
      {
        kind: 'seasonal_constraint' as const,
        contribution: 20,
        basis: { hemisphere: 'northern', windowKind: options.windowKind, status: options.status },
      },
      { kind: 'plant_impact' as const, contribution: 10, basis: { lifecycleStage: 'growing' } },
      {
        kind: 'confidence' as const,
        contribution: 15,
        basis: { source: 'horticulturally_reviewed_seasonal_fact' },
      },
    ],
    priorityScore: 60,
    explanation:
      `Cherry tomato is ${options.status} its ${options.windowKindLabel} window ` +
      `(${options.windowRange}) for this hemisphere.`,
    supersedesCandidateId: null,
    supersedesLiveCandidate: null,
  };
}

export const seasonalSowingWindowCheckFixtures: readonly RuleFixture[] = [
  {
    name: 'fires when today falls WITHIN a configured sow-outdoors window',
    reviewNotes:
      'The reviewed fact configures a sow-outdoors window of June-August; the fixture instant ' +
      '(25 July) falls inside it. Priority 60. Review: is a plain "within window" nudge worth ' +
      'this priority relative to the other launch rules?',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: [
        taxonomyFact({
          seasonalFact: reviewedSeasonalFact({ sowOutdoorsStartMonth: 6, sowOutdoorsEndMonth: 8 }),
        }),
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        fireDecision('seasonal.sowing-window-check', PLANT_A_ID, 60),
        SUCCESSION_NOT_CONFIGURED,
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [
        sowingCandidate({
          windowKind: 'sow_outdoors',
          windowKindLabel: 'sow outdoors',
          startMonth: 6,
          endMonth: 8,
          windowRange: 'June-August',
          status: 'within',
          daysUntilStart: 0,
          evaluatedAt: FIXTURE_NOW,
        }),
      ],
    },
  },
  {
    name: 'fires when today is APPROACHING a configured window (within approachWindowDays)',
    reviewNotes:
      'The reviewed fact configures a sow-outdoors window of August-September, starting 7 days ' +
      'from the fixture instant — inside the 14-day approach window. Review: is 14 days a ' +
      'sensible heads-up horizon?',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: [
        taxonomyFact({
          seasonalFact: reviewedSeasonalFact({ sowOutdoorsStartMonth: 8, sowOutdoorsEndMonth: 9 }),
        }),
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        fireDecision('seasonal.sowing-window-check', PLANT_A_ID, 60),
        SUCCESSION_NOT_CONFIGURED,
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [
        sowingCandidate({
          windowKind: 'sow_outdoors',
          windowKindLabel: 'sow outdoors',
          startMonth: 8,
          endMonth: 9,
          windowRange: 'August-September',
          status: 'approaching',
          daysUntilStart: 7,
          evaluatedAt: FIXTURE_NOW,
        }),
      ],
    },
  },
  {
    name: 'MONTH WRAPAROUND: a November-February sow-indoors window matches in January',
    reviewNotes:
      "The taxon's own window crosses the year boundary (November start, February end). " +
      'Evaluated on 15 January, today is within it — proving `monthInRange` wraps correctly ' +
      'rather than treating `startMonth > endMonth` as "never matches" or throwing.',
    facts: gardenFacts({
      evaluatedAt: new Date('2026-01-15T09:00:00Z'),
      plants: [
        plantFact({
          plantId: PLANT_A_ID,
          taxonomyReferenceId: TAXONOMY_A_ID,
          createdAt: new Date('2026-01-10T09:00:00Z'),
        }),
      ],
      hemisphere: 'northern',
      taxonomyFacts: [
        taxonomyFact({
          seasonalFact: reviewedSeasonalFact({ sowIndoorsStartMonth: 11, sowIndoorsEndMonth: 2 }),
        }),
      ],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ruleSkippedDecision('watering.dry-spell-check', {
          kind: 'weatherMissing',
          requiredKind: 'observation',
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
        fireDecision('seasonal.sowing-window-check', PLANT_A_ID, 60),
        SUCCESSION_NOT_CONFIGURED,
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [
        sowingCandidate({
          windowKind: 'sow_indoors',
          windowKindLabel: 'sow indoors',
          startMonth: 11,
          endMonth: 2,
          windowRange: 'November-February',
          status: 'within',
          daysUntilStart: 0,
          evaluatedAt: new Date('2026-01-15T09:00:00Z'),
        }),
      ],
    },
  },
  {
    name: 'whole-rule skip: the garden has never been georeferenced (hemisphere unknown)',
    reviewNotes:
      'Same taxon and a real configured window, but the garden itself has no known hemisphere. ' +
      'All three seasonal rules skip identically rather than guessing a hemisphere — never ' +
      'fabricated.',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      taxonomyFacts: [
        taxonomyFact({
          seasonalFact: reviewedSeasonalFact({ sowOutdoorsStartMonth: 6, sowOutdoorsEndMonth: 8 }),
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
      'The garden knows its hemisphere and the plant its taxon, but `TaxonomyFact.seasonalFact` ' +
      'is `null` — exactly what `gather-seasonal-facts.ts` produces for a taxon whose ONLY row ' +
      'is still `awaiting_horticultural_review` (or has no row at all). Both other seasonal ' +
      'rules report the identical reason code for the same underlying gap.',
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
    name: 'stays quiet when the reviewed fact configures no sowing windows at all',
    reviewNotes:
      'A reviewed fact exists (a root vegetable with no sow-indoors/outdoors/transplant stage ' +
      'is a legitimate row), but every window column is null. The rule reports a distinct ' +
      'reason code rather than reusing "not reviewed" for a genuinely different condition.',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: [taxonomyFact({ seasonalFact: reviewedSeasonalFact() })],
    }),
    prior: noPrior(),
    expected: {
      decisions: [
        ...ORIGINAL_FOUR_RULES_QUIET,
        notEligibleDecision(
          'seasonal.sowing-window-check',
          PLANT_A_ID,
          'taxonomy.no_sowing_windows_configured',
        ),
        SUCCESSION_NOT_CONFIGURED,
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [],
    },
  },
  {
    name: 'stays quiet when today is neither within nor approaching the only configured window',
    reviewNotes:
      'The configured sow-outdoors window (May-June) already ended weeks ago and will not ' +
      'recur for many months — well outside the 14-day approach horizon.',
    facts: gardenFacts({
      plants: [PLANT_WITH_TAXONOMY],
      hemisphere: 'northern',
      taxonomyFacts: [
        taxonomyFact({
          seasonalFact: reviewedSeasonalFact({ sowOutdoorsStartMonth: 5, sowOutdoorsEndMonth: 6 }),
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
          'taxonomy.outside_sowing_window',
        ),
        SUCCESSION_NOT_CONFIGURED,
        ROTATION_NOT_CONFIGURED,
      ],
      plannedCandidates: [],
    },
  },
];
