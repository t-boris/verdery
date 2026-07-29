/**
 * The pure suitability engine: runs every catalog rule against assembled
 * facts and concatenates their findings into one result. No IO, no clock,
 * no randomness — the same purity `evaluateGardenRules` (tasks-
 * recommendations) holds itself to, so the same inputs always produce the
 * same output and a fixture test can assert it by deep equality.
 *
 * Deliberately NOT a "first matching rule wins" evaluator: every axis a
 * rule addresses gets its own independent judgment, and a candidate's full
 * assessment is the union of every rule's findings — a hardiness blocker
 * does not suppress a sun-exposure match from also being reported.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateSuitabilityFacts, GardenSuitabilityFacts } from './suitability-facts.js';
import type { SuitabilityAssessmentResult } from './suitability-finding.js';
import type { SuitabilityRuleDefinition } from './suitability-rule-definition.js';

export function evaluateCandidateSuitability(
  candidateId: Uuid,
  rules: readonly SuitabilityRuleDefinition[],
  garden: GardenSuitabilityFacts,
  candidate: CandidateSuitabilityFacts,
): SuitabilityAssessmentResult {
  const findings = rules.flatMap((rule) => rule.evaluate(garden, candidate));
  return { candidateId, findings };
}
