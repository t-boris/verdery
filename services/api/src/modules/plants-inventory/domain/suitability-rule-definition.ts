/**
 * A suitability rule: data plus one pure evaluator function, mirroring
 * `tasks-recommendations/domain/rule-definition.ts`'s `RuleDefinition`
 * shape exactly — one pure function reading typed facts, no condition-DSL
 * interpreter (that file's own header calls this deliberate: "one pure
 * function... deterministic"). Not shared cross-module: this is an
 * independent mirror, the same "no shared cross-module vocabulary despite
 * an identical shape" convention `Hemisphere`/`RuleReviewMetadata`'s own
 * per-module copies already establish (`taxonomy-seasonal-fact.ts`'s own
 * header names this explicitly).
 *
 * `review` widens the identical `awaiting_horticultural_review` /
 * `horticulturally_reviewed` shape with THIS work package's own literal
 * (`'P11-SUIT-01'`), the same pattern that added `'P9D-SEASON-RULES-01'`
 * alongside `'P7-SAFE-01'` rather than loosening the type to `string`.
 *
 * Source: tasks-recommendations/domain/rule-definition.ts;
 * architecture/plant-intelligence-and-visual-journal.md, section
 * "10. Suitability Assessment".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { CandidateSuitabilityFacts, GardenSuitabilityFacts } from './suitability-facts.js';
import { SUITABILITY_AXES } from './suitability-finding.js';
import type { SuitabilityAxis, SuitabilityFinding } from './suitability-finding.js';

/** Reviewer metadata for a suitability rule — see this file's own header. */
export type SuitabilityRuleReviewMetadata =
  | {
      readonly reviewStatus: 'awaiting_horticultural_review';
      readonly awaitingReviewBy: 'P11-SUIT-01';
    }
  | {
      readonly reviewStatus: 'horticulturally_reviewed';
      readonly reviewedBy: string;
      /** Calendar date of sign-off, `'YYYY-MM-DD'`. */
      readonly reviewedOn: string;
    };

/** One pure evaluator: garden facts + candidate facts in, zero or more findings out. A rule may produce more than one finding (e.g. a match on one region and a caution on another) but every finding it produces must name this rule's own `axis`. */
export type SuitabilityRuleEvaluator = (
  garden: GardenSuitabilityFacts,
  candidate: CandidateSuitabilityFacts,
) => readonly SuitabilityFinding[];

export interface SuitabilityRuleDefinition {
  readonly ruleKey: string;
  readonly version: number;
  readonly axis: SuitabilityAxis;
  readonly review: SuitabilityRuleReviewMetadata;
  readonly evaluate: SuitabilityRuleEvaluator;
}

/** Validates the declarative shape of a rule definition — the same "throws a clean ValidationError before the catalog would otherwise misbehave" role `validateRuleDefinition` plays for the recommendation engine. */
export function validateSuitabilityRuleDefinition(definition: SuitabilityRuleDefinition): void {
  if (definition.ruleKey.trim().length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'ruleKey must not be blank.', {
      details: [{ code: 'plants_inventory.suitability_rule.rule_key.blank', pointer: '/ruleKey' }],
    });
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'version must be a positive integer.',
      {
        details: [
          { code: 'plants_inventory.suitability_rule.version.invalid', pointer: '/version' },
        ],
      },
    );
  }
  if (!SUITABILITY_AXES.includes(definition.axis)) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `axis must be one of: ${SUITABILITY_AXES.join(', ')}.`,
      {
        details: [{ code: 'plants_inventory.suitability_rule.axis.invalid', pointer: '/axis' }],
      },
    );
  }
}
