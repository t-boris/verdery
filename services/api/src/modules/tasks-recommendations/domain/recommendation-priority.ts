/**
 * Priority factors: section 7's bullet list as a closed vocabulary, one
 * row per factor per candidate — "The application stores the factors
 * needed to explain rank."
 *
 * The factor VALUE is structured-but-open (`unknown`, persisted as jsonb):
 * section 7 leaves priority "an explainable score OR ordered category",
 * and which of the two — and on what scale — is the calculation
 * P7-RULE-01's engine owns. This module pins WHICH factors influenced a
 * candidate (the closed kind vocabulary, one row each); the engine stage
 * defines the value shapes. See the migration's own comment on
 * `factor_value` for the full reasoning.
 *
 * Factors are optional per candidate: the pipeline computes priority AFTER
 * candidate generation (section 3's own ordering), and section 19 requires
 * evidence and a rule version on every recommendation — not factors — so
 * no at-least-one rule mirrors the evidence one.
 *
 * Source: migrations/1785600000000_recommendations-baseline.sql,
 * `tasks_recommendations.recommendation_priority_factor`;
 * architecture/recommendations-and-ai.md, section "7. Priority".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/**
 * Section 7's bullets one-to-one; "Safety and seasonal constraints" is one
 * paired bullet split into two kinds, the same split the evidence
 * vocabulary applies to its own paired bullet — see the migration's
 * comment for the full mapping.
 */
export type RecommendationPriorityFactorKind =
  | 'urgency_window'
  | 'plant_impact'
  | 'confidence'
  | 'weather_opportunity_or_risk'
  | 'user_effort_and_availability'
  | 'task_overlap'
  | 'safety_constraint'
  | 'seasonal_constraint';

export interface RecommendationPriorityFactor {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly factorKind: RecommendationPriorityFactorKind;
  /** Structured-but-open — see this file's own header comment. Never `undefined`: a factor with no recorded value explains nothing (the column is `NOT NULL`). */
  readonly factorValue: unknown;
  readonly createdAt: Date;
}

/** The per-item shape `createRecommendationPriorityFactors` accepts before the owning candidate id and timestamp are bound. */
export interface NewRecommendationPriorityFactor {
  readonly id: Uuid;
  readonly factorKind: RecommendationPriorityFactorKind;
  readonly factorValue: unknown;
}

/**
 * Validates and binds a candidate's priority factors: every factor kind at
 * most once (mirroring the migration's
 * `recommendation_priority_factor_candidate_kind_key` UNIQUE one level
 * up), and every value present (mirroring the column's `NOT NULL`).
 */
export function createRecommendationPriorityFactors(
  candidateId: Uuid,
  factors: readonly NewRecommendationPriorityFactor[],
  now: Date,
): readonly RecommendationPriorityFactor[] {
  const seenKinds = new Set<RecommendationPriorityFactorKind>();

  return factors.map((factor, index) => {
    if (seenKinds.has(factor.factorKind)) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        `priority factor kind '${factor.factorKind}' appears more than once.`,
        {
          details: [
            {
              code: 'tasks_recommendations.recommendation_priority_factor.kind.duplicated',
              pointer: `/priorityFactors/${String(index)}`,
            },
          ],
        },
      );
    }
    seenKinds.add(factor.factorKind);

    if (factor.factorValue === undefined) {
      throw new ValidationError(
        SharedErrorCode.RequestInvalid,
        `priority factor '${factor.factorKind}' must carry a value.`,
        {
          details: [
            {
              code: 'tasks_recommendations.recommendation_priority_factor.value.missing',
              pointer: `/priorityFactors/${String(index)}`,
            },
          ],
        },
      );
    }

    return {
      id: factor.id,
      candidateId,
      factorKind: factor.factorKind,
      factorValue: factor.factorValue,
      createdAt: now,
    };
  });
}
