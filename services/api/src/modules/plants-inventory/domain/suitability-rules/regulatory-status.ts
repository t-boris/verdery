/**
 * Evaluates invasive/regulated status from the candidate's resolved
 * distribution assertions (`integrations.plant_distribution_assertion`,
 * reviewed rows only — already filtered before this rule ever sees them,
 * the same "not yet reviewed cannot be read as known" rule
 * `plant-profile-version.ts` applies to fact assertions).
 *
 * `GardenSuitabilityFacts.region` is always `null` today (see that file's
 * own header — no garden-to-US-region resolution exists yet), so this rule
 * cannot yet match the garden's OWN region against a per-region status.
 * Until it can, the rule degrades honestly rather than guessing:
 *
 * - Any region on record showing `invasive`/`regulated` becomes a
 *   `caution`, not a `blocker` — a real signal exists, but this garden's
 *   own applicability could not be confirmed.
 * - Zero regions showing either status becomes an `assumption`, explicit
 *   about what was assumed and why: absence of a flag ANYWHERE on record is
 *   treated as likely (not confirmed) absence of one HERE too.
 *
 * When `region` is eventually populated, an exact regional match should
 * upgrade both cases to a real `match`/`blocker` — a pure addition to this
 * rule's `evaluate`, not a rewrite; the `region !== null` branch below is
 * already shaped for that.
 */

import type { CandidateSuitabilityFacts, GardenSuitabilityFacts } from '../suitability-facts.js';
import type { SuitabilityEvidence, SuitabilityFinding } from '../suitability-finding.js';
import type { SuitabilityRuleDefinition } from '../suitability-rule-definition.js';

const FLAGGED_STATUSES = new Set(['invasive', 'regulated']);

function toEvidence(
  facts: CandidateSuitabilityFacts['distributionFacts'],
): readonly SuitabilityEvidence[] {
  return facts.map((fact) => ({
    factKey: `distribution.${fact.region}`,
    value: fact.status,
    sourceCitation: fact.sourceCitation,
  }));
}

function evaluate(
  garden: GardenSuitabilityFacts,
  candidate: CandidateSuitabilityFacts,
): readonly SuitabilityFinding[] {
  if (candidate.distributionFacts.length === 0) {
    return [{ category: 'unknown', axis: 'regulatory_status', reason: 'plant_fact_missing' }];
  }

  if (garden.region !== null) {
    const regional = candidate.distributionFacts.find((fact) => fact.region === garden.region);
    if (regional === undefined) {
      return [{ category: 'unknown', axis: 'regulatory_status', reason: 'plant_fact_missing' }];
    }
    const evidence = toEvidence([regional]);
    if (FLAGGED_STATUSES.has(regional.status)) {
      return [
        {
          category: 'blocker',
          axis: 'regulatory_status',
          explanation: `This plant is ${regional.status} in ${garden.region}, this garden's own region.`,
          evidence,
        },
      ];
    }
    return [
      {
        category: 'match',
        axis: 'regulatory_status',
        explanation: `This plant is ${regional.status} in ${garden.region}, this garden's own region — no regulatory restriction applies.`,
        evidence,
      },
    ];
  }

  const flagged = candidate.distributionFacts.filter((fact) => FLAGGED_STATUSES.has(fact.status));
  if (flagged.length > 0) {
    const regions = flagged.map((fact) => fact.region).join(', ');
    return [
      {
        category: 'caution',
        axis: 'regulatory_status',
        explanation: `This plant is invasive or regulated in at least one US region on record (${regions}); this garden's own region could not be confirmed.`,
        evidence: toEvidence(flagged),
      },
    ];
  }

  return [
    {
      category: 'assumption',
      axis: 'regulatory_status',
      explanation:
        "No region on record flags this plant as invasive or regulated; this garden's own region could not be confirmed, so absence of a flag elsewhere is assumed (not verified) to extend here.",
      assumedValue: 'not_regulated',
    },
  ];
}

export const REGULATORY_STATUS_RULE: SuitabilityRuleDefinition = {
  ruleKey: 'suitability.regulatory_status',
  version: 1,
  axis: 'regulatory_status',
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P11-SUIT-01' },
  evaluate,
};
