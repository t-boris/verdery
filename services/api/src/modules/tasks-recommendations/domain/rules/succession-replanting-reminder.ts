/**
 * `succession.replanting-reminder` v1 — ordinary care ("routine ...
 * timing", section 13). P9D-SEASON-RULES-01, Stage 2 of P9D-SEASON-01.
 *
 * WHAT IT SAYS: for a plant whose own taxon has a reviewed
 * `successionIntervalDays` (a crop that benefits from staggered
 * re-sowing, e.g. lettuce or radish), reminds the gardener to sow another
 * batch. The concrete number is quoted honestly in the explanation.
 *
 * RECURRENCE DESIGN DECISION — read before touching `parameters` or
 * `timing`: the brief for this rule says to set `timing
 * .recurrenceIntervalMs` from `successionIntervalDays * DAY_MS`, reusing
 * the engine's OWN recurrence mechanism (`rule-evaluation.ts` phase 4)
 * instead of building a second one. That mechanism is real and reused
 * here, but `RuleTimingSpec.recurrenceIntervalMs` is a SINGLE value on the
 * static `RuleDefinition` — one per rule VERSION, applied uniformly to
 * every (rule, target) pair the engine evaluates (see
 * `rule-evaluation.ts`'s own `rule.timing.recurrenceIntervalMs` reads,
 * always through the shared `rule`, never per-target). `successionIntervalDays`
 * is real per-TAXON data that can legitimately differ across the plants
 * this ONE rule fires for in the SAME garden (lettuce every 14 days,
 * beans every 21). A single static field cannot literally encode a
 * per-taxon-varying interval, and `RuleEvaluator` receives only
 * `GardenFacts` — never `PriorRecommendationState` — so the rule's own
 * `evaluate` has no access to "when did I last fire for this plant" to
 * build an alternative per-plant timing check without duplicating the
 * engine's own recurrence bookkeeping (exactly what the brief says not to
 * do).
 *
 * RESOLUTION (the most conservative reading available under this real
 * constraint): `timing.recurrenceIntervalMs` is set from
 * `PARAMETERS.recurrenceIntervalDaysFallback * DAY_MS` — ONE reviewable
 * placeholder cadence, the same "defensible default a horticulturist must
 * confirm or correct" posture every other launch rule's own timing values
 * already carry. ELIGIBILITY still genuinely depends on the taxon's own
 * `successionIntervalDays` being configured (never fabricated — absent
 * means a typed skip, not a guessed cadence), and the REAL per-taxon
 * number is quoted honestly in both the evidence (`factValue
 * .successionIntervalDays`) and the rendered explanation, so a user
 * reading the recommendation sees the true figure even though the
 * engine's own re-fire spacing is presently a single garden-wide
 * fallback, not a per-taxon one. A later stage that wants genuinely
 * per-target recurrence spacing needs an engine change (a `RuleTimingSpec`
 * override on the eligible outcome, mirroring `windowEnd`'s own
 * fact-derived override) — out of scope for this rule alone to invent.
 *
 * FACTS CONSULTED: the garden's own `hemisphere`, each plant's own
 * `taxonomyReferenceId`, and the resulting `TaxonomyFact.seasonalFact`'s
 * `successionIntervalDays`. No weather.
 *
 * REVIEW STATUS: awaiting horticultural review (P9D-SEASON-RULES-01).
 */

import type { GardenFacts, PlantFact } from '../garden-facts.js';
import { taxonomyFactFor } from '../garden-facts.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import { DAY_MS, HEMISPHERE_UNKNOWN_DETAIL, plantTarget } from './rule-support.js';

const PARAMETERS = {
  validityWindowDays: 10,
  /** See this file's own header, "RECURRENCE DESIGN DECISION": a garden-wide fallback cadence, not the per-taxon `successionIntervalDays` value the engine's static timing field cannot literally encode. */
  recurrenceIntervalDaysFallback: 21,
} as const;

function notEligibleFor(plant: PlantFact, reasonCode: string): RuleTargetEvaluation {
  return { outcome: 'notEligible', target: plantTarget(plant.plantId), reasonCode };
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
  const { successionIntervalDays } = taxonomyFact.seasonalFact;
  if (successionIntervalDays === null) {
    return notEligibleFor(plant, 'taxonomy.succession_interval_not_configured');
  }

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
        factKey: 'taxonomy.succession_interval',
        factValue: {
          taxonomyReferenceId: plant.taxonomyReferenceId,
          hemisphere: facts.hemisphere,
          successionIntervalDays,
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
        basis: { hemisphere: facts.hemisphere, successionIntervalDays },
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
      'taxonomy.succession_interval_days': successionIntervalDays,
    },
    windowEnd: null,
  };
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

export const successionReplantingReminderRule: RuleDefinition = {
  ruleKey: 'succession.replanting-reminder',
  version: 1,
  safetyTier: 'ordinary_care',
  careCategory: 'succession_planting',
  actionTitle: 'Sow a new succession batch',
  description:
    'Reminds the gardener to sow another batch for a taxon with a reviewed succession ' +
    'benefit, quoting the real configured interval. Skips honestly when the hemisphere, the ' +
    'taxon, a reviewed seasonal fact, or a configured succession interval is unknown. See this ' +
    'file header for how recurrence spacing is handled given the engine only carries one ' +
    'static interval per rule version.',
  urgency: 'normal',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowDays * DAY_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalDaysFallback * DAY_MS,
  },
  weatherPolicy: { use: 'notUsed' },
  requiredEvidenceKinds: ['plant_identity', 'seasonal_calendar'],
  explanationTemplate:
    '{plant.display_name} benefits from succession sowing roughly every ' +
    '{taxonomy.succession_interval_days} days. Consider sowing a new batch now.',
  parameters: PARAMETERS,
  review: {
    reviewStatus: 'awaiting_horticultural_review',
    awaitingReviewBy: 'P9D-SEASON-RULES-01',
  },
  evaluate,
};
