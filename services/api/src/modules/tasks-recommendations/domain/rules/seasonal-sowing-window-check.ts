/**
 * `seasonal.sowing-window-check` v1 — ordinary care ("routine ... timing",
 * section 13). P9D-SEASON-RULES-01, Stage 2 of P9D-SEASON-01.
 *
 * WHAT IT SAYS: when today falls WITHIN, or is APPROACHING
 * (`approachWindowDays` ahead of), a reviewed sow-indoors, sow-outdoors, or
 * transplant window for a plant's own taxon and the garden's own
 * hemisphere, names which window and suggests acting. "Within" always
 * wins over "approaching" when a plant sits inside more than one
 * configured window at once (a garden can sow indoors while another
 * taxon's outdoor window is also open); the three window kinds are
 * checked in the fixed order sow-indoors, sow-outdoors, transplant for a
 * deterministic pick.
 *
 * FACTS CONSULTED: the garden's own `hemisphere`, each plant's own
 * `taxonomyReferenceId`, and the `TaxonomyFact.seasonalFact` that taxon
 * resolves to for this hemisphere (only ever a `horticulturally_reviewed`
 * row — `gather-seasonal-facts.ts` never surfaces an
 * `awaiting_horticultural_review` one). No weather.
 *
 * HONEST SKIPS, never a fabricated window: a `null` hemisphere (garden
 * never georeferenced) skips the WHOLE rule — every target would fail
 * identically, the same posture `weather.frost-watch` takes for a missing
 * weather record. Per plant: unknown taxonomy, no reviewed seasonal fact,
 * a reviewed fact with every window column `null`, or today simply
 * falling outside every configured window (and not within
 * `approachWindowDays` of one) are each a distinct typed `notEligible`
 * reason code.
 *
 * MONTH WRAPAROUND: a window like November-February (sowIndoorsStartMonth
 * `11`, sowIndoorsEndMonth `2`) crosses the year boundary — handled by
 * `monthInRange`/`daysUntilNextMonthStart` (`rule-support.ts`), unit-tested
 * directly in `rule-support.test.ts` and exercised black-box in this
 * rule's own fixtures.
 *
 * REVIEW STATUS: awaiting horticultural review (P9D-SEASON-RULES-01). The
 * window kinds' priority order and `approachWindowDays`/timing values in
 * `parameters` are defensible placeholders a horticulturist must confirm
 * or correct.
 */

import type { TaxonomySeasonalFact } from '../../../plants-inventory/public.js';
import type { GardenFacts, PlantFact } from '../garden-facts.js';
import { taxonomyFactFor } from '../garden-facts.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import {
  DAY_MS,
  HEMISPHERE_UNKNOWN_DETAIL,
  daysUntilNextMonthStart,
  monthInRange,
  plantTarget,
} from './rule-support.js';

const PARAMETERS = {
  /** A window starting within this many days counts as "approaching". */
  approachWindowDays: 14,
  validityWindowDays: 14,
  recurrenceIntervalDays: 14,
} as const;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

type SowingWindowKind = 'sow_indoors' | 'sow_outdoors' | 'transplant';

const WINDOW_LABELS: Record<SowingWindowKind, string> = {
  sow_indoors: 'sow indoors',
  sow_outdoors: 'sow outdoors',
  transplant: 'transplant',
};

interface ConfiguredWindow {
  readonly kind: SowingWindowKind;
  readonly startMonth: number;
  readonly endMonth: number;
}

/** Every window the reviewed fact actually configures, in the fixed sow-indoors/sow-outdoors/transplant priority order — never a fabricated one for a `null` column pair. */
function configuredWindows(fact: TaxonomySeasonalFact): readonly ConfiguredWindow[] {
  const windows: ConfiguredWindow[] = [];
  if (fact.sowIndoorsStartMonth !== null && fact.sowIndoorsEndMonth !== null) {
    windows.push({
      kind: 'sow_indoors',
      startMonth: fact.sowIndoorsStartMonth,
      endMonth: fact.sowIndoorsEndMonth,
    });
  }
  if (fact.sowOutdoorsStartMonth !== null && fact.sowOutdoorsEndMonth !== null) {
    windows.push({
      kind: 'sow_outdoors',
      startMonth: fact.sowOutdoorsStartMonth,
      endMonth: fact.sowOutdoorsEndMonth,
    });
  }
  if (fact.transplantStartMonth !== null && fact.transplantEndMonth !== null) {
    windows.push({
      kind: 'transplant',
      startMonth: fact.transplantStartMonth,
      endMonth: fact.transplantEndMonth,
    });
  }
  return windows;
}

function notEligibleFor(plant: PlantFact, reasonCode: string): RuleTargetEvaluation {
  return { outcome: 'notEligible', target: plantTarget(plant.plantId), reasonCode };
}

function eligibleFor(
  facts: GardenFacts,
  plant: PlantFact,
  window: ConfiguredWindow,
  status: 'within' | 'approaching',
  daysUntilStart: number,
): RuleTargetEvaluation {
  const windowRange = `${MONTH_NAMES[window.startMonth - 1]}-${MONTH_NAMES[window.endMonth - 1]}`;
  return {
    outcome: 'eligible',
    target: plantTarget(plant.plantId),
    evidence: [
      {
        kind: 'plant_identity',
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: plant.plantId,
        sourceWeatherRecordId: null,
        factKey: 'plant.identity',
        factValue: { taxonomyReferenceId: plant.taxonomyReferenceId },
      },
      {
        kind: 'seasonal_calendar',
        sourceObservationId: null,
        sourceTaskId: null,
        sourcePlantId: null,
        sourceWeatherRecordId: null,
        factKey: 'taxonomy.sowing_window',
        factValue: {
          taxonomyReferenceId: plant.taxonomyReferenceId,
          hemisphere: facts.hemisphere,
          windowKind: window.kind,
          startMonth: window.startMonth,
          endMonth: window.endMonth,
          status,
          daysUntilStart,
        },
      },
    ],
    factors: [
      {
        kind: 'urgency_window',
        contribution: 15,
        basis: { urgency: 'normal', validityWindowDays: PARAMETERS.validityWindowDays },
      },
      {
        kind: 'seasonal_constraint',
        contribution: 20,
        basis: { hemisphere: facts.hemisphere, windowKind: window.kind, status },
      },
      {
        kind: 'plant_impact',
        contribution: 10,
        basis: { lifecycleStage: plant.lifecycleStage },
      },
      {
        kind: 'confidence',
        contribution: 15,
        basis: { source: 'horticulturally_reviewed_seasonal_fact' },
      },
    ],
    explanationFacts: {
      'plant.display_name': plant.displayName,
      'taxonomy.window_kind_label': WINDOW_LABELS[window.kind],
      'taxonomy.window_range': windowRange,
      'taxonomy.window_status': status,
    },
    windowEnd: null,
  };
}

function evaluatePlant(facts: GardenFacts, plant: PlantFact): RuleTargetEvaluation {
  if (plant.status !== 'active') {
    return notEligibleFor(plant, 'plant.status_not_active');
  }
  if (plant.taxonomyReferenceId === null) {
    return notEligibleFor(plant, 'plant.taxonomy_unknown');
  }
  const taxonomyFact = taxonomyFactFor(facts, plant.taxonomyReferenceId);
  if (taxonomyFact === null || taxonomyFact.seasonalFact === null) {
    return notEligibleFor(plant, 'taxonomy.seasonal_fact_not_reviewed');
  }
  const windows = configuredWindows(taxonomyFact.seasonalFact);
  if (windows.length === 0) {
    return notEligibleFor(plant, 'taxonomy.no_sowing_windows_configured');
  }

  const currentMonth = facts.evaluatedAt.getUTCMonth() + 1;
  const withinMatch = windows.find((window) =>
    monthInRange(currentMonth, window.startMonth, window.endMonth),
  );
  if (withinMatch !== undefined) {
    return eligibleFor(facts, plant, withinMatch, 'within', 0);
  }

  let closest: { readonly window: ConfiguredWindow; readonly daysUntil: number } | null = null;
  for (const window of windows) {
    const daysUntil = daysUntilNextMonthStart(facts.evaluatedAt, window.startMonth);
    if (daysUntil > 0 && daysUntil <= PARAMETERS.approachWindowDays) {
      if (closest === null || daysUntil < closest.daysUntil) {
        closest = { window, daysUntil };
      }
    }
  }
  if (closest !== null) {
    return eligibleFor(facts, plant, closest.window, 'approaching', closest.daysUntil);
  }

  return notEligibleFor(plant, 'taxonomy.outside_sowing_window');
}

function evaluate(facts: GardenFacts): ReturnType<RuleDefinition['evaluate']> {
  if (facts.hemisphere === null) {
    return {
      outcome: 'skipped',
      reason: { kind: 'factMissing', detail: HEMISPHERE_UNKNOWN_DETAIL },
    };
  }

  const targets: RuleTargetEvaluation[] = facts.plants.map((plant) => evaluatePlant(facts, plant));
  return { outcome: 'evaluated', targets };
}

export const seasonalSowingWindowCheckRule: RuleDefinition = {
  ruleKey: 'seasonal.sowing-window-check',
  version: 1,
  safetyTier: 'ordinary_care',
  careCategory: 'sowing',
  actionTitle: 'Sow, transplant, or prepare for the upcoming window',
  description:
    'Notes when today falls within, or is approaching, a reviewed sow-indoors, sow-outdoors, ' +
    'or transplant window for the plant taxon and the garden hemisphere. Skips honestly when ' +
    'the hemisphere, the taxon, or a reviewed seasonal fact is unknown, or when no window is ' +
    'configured for this taxon at all.',
  urgency: 'normal',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowDays * DAY_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalDays * DAY_MS,
  },
  weatherPolicy: { use: 'notUsed' },
  requiredEvidenceKinds: ['plant_identity', 'seasonal_calendar'],
  explanationTemplate:
    '{plant.display_name} is {taxonomy.window_status} its {taxonomy.window_kind_label} window ' +
    '({taxonomy.window_range}) for this hemisphere.',
  parameters: PARAMETERS,
  review: {
    reviewStatus: 'awaiting_horticultural_review',
    awaitingReviewBy: 'P9D-SEASON-RULES-01',
  },
  evaluate,
};
