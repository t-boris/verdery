/**
 * Compares the garden's declared drainage (`garden_context_fact`,
 * `drainage` kind) against the candidate's resolved `soilDrainage` profile
 * fact — same ordinal-distance idiom as `sun-exposure-compatibility.ts`,
 * applied to `gardens-mapping`'s own `DrainageValue` vocabulary
 * (`well_drained`/`poor_drainage`/`waterlogged`).
 */

import type { DrainageValue } from '../../../gardens-mapping/public.js';
import type { CandidateSuitabilityFacts, GardenSuitabilityFacts } from '../suitability-facts.js';
import type { SuitabilityFinding } from '../suitability-finding.js';
import type { SuitabilityRuleDefinition } from '../suitability-rule-definition.js';

const DRAINAGE_ORDER: Readonly<Record<DrainageValue, number>> = {
  well_drained: 0,
  poor_drainage: 1,
  waterlogged: 2,
};

const SOIL_DRAINAGE_FACT_KEY = 'soilDrainage';

function evaluate(
  garden: GardenSuitabilityFacts,
  candidate: CandidateSuitabilityFacts,
): readonly SuitabilityFinding[] {
  if (garden.drainage === null) {
    return [{ category: 'unknown', axis: 'drainage', reason: 'garden_context_missing' }];
  }
  if (candidate.profileFacts === null) {
    return [{ category: 'unknown', axis: 'drainage', reason: 'plant_fact_missing' }];
  }

  const drainageFact = candidate.profileFacts.find(
    (fact) => fact.factKey === SOIL_DRAINAGE_FACT_KEY,
  );
  if (
    drainageFact === undefined ||
    typeof drainageFact.value !== 'string' ||
    !(drainageFact.value in DRAINAGE_ORDER)
  ) {
    return [{ category: 'unknown', axis: 'drainage', reason: 'plant_fact_missing' }];
  }
  const requirement = drainageFact.value as DrainageValue;

  const distance = Math.abs(DRAINAGE_ORDER[garden.drainage] - DRAINAGE_ORDER[requirement]);
  const evidence = [
    { factKey: 'gardenContext.drainage', value: garden.drainage, sourceCitation: null },
    {
      factKey: drainageFact.factKey,
      value: drainageFact.value,
      sourceCitation: drainageFact.sourceCitation,
    },
  ];

  if (distance === 0) {
    return [
      {
        category: 'match',
        axis: 'drainage',
        explanation: `This garden's ${garden.drainage.replace('_', ' ')} soil matches the plant's ${requirement.replace('_', ' ')} preference.`,
        evidence,
      },
    ];
  }
  if (distance === 1) {
    return [
      {
        category: 'caution',
        axis: 'drainage',
        explanation: `This garden's ${garden.drainage.replace('_', ' ')} soil differs from the plant's ${requirement.replace('_', ' ')} preference.`,
        evidence,
      },
    ];
  }
  return [
    {
      category: 'blocker',
      axis: 'drainage',
      explanation: `This garden's ${garden.drainage.replace('_', ' ')} soil is the opposite of the plant's ${requirement.replace('_', ' ')} preference.`,
      evidence,
    },
  ];
}

export const DRAINAGE_COMPATIBILITY_RULE: SuitabilityRuleDefinition = {
  ruleKey: 'suitability.drainage_compatibility',
  version: 1,
  axis: 'drainage',
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P11-SUIT-01' },
  evaluate,
};
