/**
 * Compares the garden's declared sun exposure (`garden_context_fact`,
 * `sun_exposure` kind) against the candidate's resolved `sunRequirement`
 * profile fact — both drawn from the SAME closed vocabulary
 * (`full_shade`/`partial_shade`/`partial_sun`/`full_sun`, `gardens-mapping`'s
 * `SunExposureValue`), ordered by light intensity, so "how far apart" is a
 * simple ordinal distance rather than an invented scoring formula.
 *
 * "Missing context never becomes a positive match" (design doc section 10):
 * either fact absent is `unknown`, never a default toward the common case.
 */

import type { SunExposureValue } from '../../../gardens-mapping/public.js';
import type { CandidateSuitabilityFacts, GardenSuitabilityFacts } from '../suitability-facts.js';
import type { SuitabilityFinding } from '../suitability-finding.js';
import type { SuitabilityRuleDefinition } from '../suitability-rule-definition.js';

const SUN_EXPOSURE_ORDER: Readonly<Record<SunExposureValue, number>> = {
  full_shade: 0,
  partial_shade: 1,
  partial_sun: 2,
  full_sun: 3,
};

const SUN_REQUIREMENT_FACT_KEY = 'sunRequirement';

function evaluate(
  garden: GardenSuitabilityFacts,
  candidate: CandidateSuitabilityFacts,
): readonly SuitabilityFinding[] {
  if (garden.sunExposure === null) {
    return [{ category: 'unknown', axis: 'sun_exposure', reason: 'garden_context_missing' }];
  }
  if (candidate.profileFacts === null) {
    return [{ category: 'unknown', axis: 'sun_exposure', reason: 'plant_fact_missing' }];
  }

  const sunFact = candidate.profileFacts.find((fact) => fact.factKey === SUN_REQUIREMENT_FACT_KEY);
  if (
    sunFact === undefined ||
    typeof sunFact.value !== 'string' ||
    !(sunFact.value in SUN_EXPOSURE_ORDER)
  ) {
    return [{ category: 'unknown', axis: 'sun_exposure', reason: 'plant_fact_missing' }];
  }
  const requirement = sunFact.value as SunExposureValue;

  const distance = Math.abs(
    SUN_EXPOSURE_ORDER[garden.sunExposure] - SUN_EXPOSURE_ORDER[requirement],
  );
  const evidence = [
    { factKey: 'gardenContext.sunExposure', value: garden.sunExposure, sourceCitation: null },
    { factKey: sunFact.factKey, value: sunFact.value, sourceCitation: sunFact.sourceCitation },
  ];

  if (distance === 0) {
    return [
      {
        category: 'match',
        axis: 'sun_exposure',
        explanation: `This garden's ${garden.sunExposure.replace('_', ' ')} matches the plant's ${requirement.replace('_', ' ')} requirement.`,
        evidence,
      },
    ];
  }
  if (distance === 1) {
    return [
      {
        category: 'caution',
        axis: 'sun_exposure',
        explanation: `This garden's ${garden.sunExposure.replace('_', ' ')} is close to, but not exactly, the plant's ${requirement.replace('_', ' ')} requirement.`,
        evidence,
      },
    ];
  }
  return [
    {
      category: 'blocker',
      axis: 'sun_exposure',
      explanation: `This garden's ${garden.sunExposure.replace('_', ' ')} is far from the plant's ${requirement.replace('_', ' ')} requirement.`,
      evidence,
    },
  ];
}

export const SUN_EXPOSURE_COMPATIBILITY_RULE: SuitabilityRuleDefinition = {
  ruleKey: 'suitability.sun_exposure_compatibility',
  version: 1,
  axis: 'sun_exposure',
  review: { reviewStatus: 'awaiting_horticultural_review', awaitingReviewBy: 'P11-SUIT-01' },
  evaluate,
};
