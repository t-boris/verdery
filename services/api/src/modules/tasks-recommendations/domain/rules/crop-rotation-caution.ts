/**
 * `rotation.crop-rotation-caution` v1 — ordinary care ("routine ...
 * timing", section 13; a rotation caution is a maintenance judgment, not a
 * disease diagnosis — `disease_diagnosis`/`pest_treatment` stay excluded
 * content categories this rule never touches). P9D-SEASON-RULES-01,
 * Stage 2 of P9D-SEASON-01.
 *
 * WHAT IT SAYS: warns when a plant's own bed most recently grew the SAME
 * botanical family within the taxon's own reviewed `rotationRestSeasons`
 * — a same-family succession that horticultural guidance generally warns
 * against (soil-borne disease and pest buildup). Never claims a
 * diagnosis; only names the prior occupant's family and how long ago it
 * left.
 *
 * "SEASON" LENGTH — a genuine ambiguity this stage's own brief leaves
 * unresolved: `rotationRestSeasons` (Stage 1, `taxonomy_seasonal_fact
 * .rotation_rest_seasons`) is an unbounded integer count of "seasons",
 * but nothing in this codebase defines how long a "season" IS in elapsed
 * days — `GardenFacts` has no season-boundary concept at all (only
 * calendar-month sow/transplant/harvest windows). RESOLUTION: one
 * rotation season = `PARAMETERS.rotationSeasonDays` (`365`, i.e. one
 * year) — the most conservative, most defensible reading available:
 * real-world crop-rotation guidance is near-universally expressed in
 * YEARS ("wait three years before replanting nightshades"), matching how
 * many temperate gardens run one planting cycle of a given crop per
 * calendar year. A shorter season length would UNDER-warn (declaring a
 * rest period satisfied before real-world guidance would), which is the
 * wrong direction for a caution rule to err in.
 *
 * FACTS CONSULTED: the garden's own `hemisphere` (needed only because
 * `rotationRestSeasons` lives on the SAME per-hemisphere reviewed row as
 * the sowing windows — see `taxonomyFactFor`), each plant's own
 * `taxonomyReferenceId`/`family`/`gardenAreaMapObjectId`, and
 * `PriorBedOccupantFact` (`gather-seasonal-facts.ts`'s bed-occupancy
 * derivation). No weather.
 *
 * HONEST SKIPS: a `null` hemisphere skips the WHOLE rule (mirrors the
 * other two seasonal rules). Per plant: unknown taxonomy, no reviewed
 * seasonal fact, unknown family, no configured `rotationRestSeasons`
 * ("no known conflict threshold means no caution to raise" — the brief's
 * own words), no bed placement, no known prior occupant (a new bed, or
 * one whose history predates the lookback window — "no known conflict"),
 * a prior occupant of a DIFFERENT family, or a prior occupant whose rest
 * period has already elapsed are each their own typed `notEligible`
 * reason code — never collapsed into one vague skip.
 *
 * REVIEW STATUS: awaiting horticultural review (P9D-SEASON-RULES-01). The
 * season-length constant above all is a placeholder a horticulturist must
 * confirm or correct.
 */

import type { GardenFacts, PlantFact, PriorBedOccupantFact } from '../garden-facts.js';
import { priorBedOccupantFor, taxonomyFactFor } from '../garden-facts.js';
import type { RuleDefinition, RuleTargetEvaluation } from '../rule-definition.js';
import {
  DAY_MS,
  HEMISPHERE_UNKNOWN_DETAIL,
  plantTarget,
  wholeDaysBetween,
} from './rule-support.js';

const PARAMETERS = {
  /** One rotation "season" in days — see this file's own header, "SEASON" LENGTH. */
  rotationSeasonDays: 365,
  validityWindowDays: 21,
  recurrenceIntervalDays: 30,
} as const;

function notEligibleFor(plant: PlantFact, reasonCode: string): RuleTargetEvaluation {
  return { outcome: 'notEligible', target: plantTarget(plant.plantId), reasonCode };
}

function eligibleFor(
  facts: GardenFacts,
  plant: PlantFact,
  family: string,
  rotationRestSeasons: number,
  priorOccupant: PriorBedOccupantFact,
  elapsedDays: number,
): RuleTargetEvaluation {
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
        factKey: 'bed.rotation_conflict',
        factValue: {
          taxonomyReferenceId: plant.taxonomyReferenceId,
          hemisphere: facts.hemisphere,
          family,
          rotationRestSeasons,
          priorFamily: priorOccupant.priorFamily,
          priorOccupancyEndedAt: priorOccupant.priorOccupancyEndedAt?.toISOString() ?? null,
          elapsedDays,
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
        basis: { hemisphere: facts.hemisphere, rotationRestSeasons, elapsedDays },
      },
      {
        kind: 'plant_impact',
        contribution: 15,
        basis: { family },
      },
      {
        kind: 'confidence',
        contribution: 15,
        basis: { source: 'bed_occupancy_history_and_reviewed_seasonal_fact' },
      },
    ],
    explanationFacts: {
      'plant.display_name': plant.displayName,
      'taxonomy.family': family,
      'taxonomy.rotation_rest_seasons': rotationRestSeasons,
      'bed.days_since_prior_family': elapsedDays,
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
  if (taxonomyFact.family === null) {
    return notEligibleFor(plant, 'taxonomy.family_unknown');
  }
  const { rotationRestSeasons } = taxonomyFact.seasonalFact;
  if (rotationRestSeasons === null) {
    return notEligibleFor(plant, 'taxonomy.rotation_rest_period_not_configured');
  }
  if (plant.gardenAreaMapObjectId === null) {
    return notEligibleFor(plant, 'plant.not_placed');
  }

  const priorOccupant = priorBedOccupantFor(facts, plant.plantId);
  if (priorOccupant === null || priorOccupant.priorFamily === null) {
    return notEligibleFor(plant, 'bed.no_prior_occupant_conflict');
  }
  if (priorOccupant.priorFamily !== taxonomyFact.family) {
    return notEligibleFor(plant, 'bed.prior_occupant_different_family');
  }
  if (priorOccupant.priorOccupancyEndedAt === null) {
    // Structurally unreachable: `gather-seasonal-facts.ts` only ever sets
    // `priorFamily` alongside a real `priorOccupancyEndedAt`. Kept as an
    // honest typed skip rather than a non-null assertion.
    return notEligibleFor(plant, 'bed.prior_occupant_departure_unknown');
  }

  const elapsedDays = wholeDaysBetween(priorOccupant.priorOccupancyEndedAt, facts.evaluatedAt);
  const restDaysThreshold = rotationRestSeasons * PARAMETERS.rotationSeasonDays;
  if (elapsedDays >= restDaysThreshold) {
    return notEligibleFor(plant, 'bed.rotation_rest_period_elapsed');
  }

  return eligibleFor(
    facts,
    plant,
    taxonomyFact.family,
    rotationRestSeasons,
    priorOccupant,
    elapsedDays,
  );
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

export const cropRotationCautionRule: RuleDefinition = {
  ruleKey: 'rotation.crop-rotation-caution',
  version: 1,
  safetyTier: 'ordinary_care',
  careCategory: 'crop_rotation',
  actionTitle: 'Avoid replanting the same family so soon',
  description:
    "Warns when a plant's own bed most recently grew the same botanical family within that " +
    "taxon's own reviewed rest period, naming the prior family and how long ago it left. Skips " +
    'honestly when the hemisphere, taxon, family, rotation rest period, bed placement, or a ' +
    'known prior occupant is missing — no known conflict threshold means no caution to raise.',
  urgency: 'normal',
  timing: {
    validityWindowMs: PARAMETERS.validityWindowDays * DAY_MS,
    recurrenceIntervalMs: PARAMETERS.recurrenceIntervalDays * DAY_MS,
  },
  weatherPolicy: { use: 'notUsed' },
  requiredEvidenceKinds: ['plant_identity', 'seasonal_calendar'],
  explanationTemplate:
    '{plant.display_name} is planted in a bed that most recently grew the same family ' +
    '({taxonomy.family}) {bed.days_since_prior_family} days ago, inside the recommended ' +
    '{taxonomy.rotation_rest_seasons}-season rest period. Consider a different bed or family ' +
    'next time.',
  parameters: PARAMETERS,
  review: {
    reviewStatus: 'awaiting_horticultural_review',
    awaitingReviewBy: 'P9D-SEASON-RULES-01',
  },
  evaluate,
};
