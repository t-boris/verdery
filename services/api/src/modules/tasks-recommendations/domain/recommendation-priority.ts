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
import { InternalError, ValidationError } from '../../../platform/errors/application-error.js';
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

/**
 * The engine's persisted factor-value shape (P7-RULE-01's answer to
 * section 7's open "score or ordered category" choice): every stored
 * `factor_value` is `{ contribution, basis }`, and the candidate's
 * priority is the clamped-to-[0,100] sum of the contributions — "the
 * stored rows alone reproduce and explain the rank."
 */
export interface StoredPriorityFactorValue {
  /** Integer within ±100 — `validateFactorContribution`'s own bound, checked again on read below. */
  readonly contribution: number;
  /** The named facts the contribution is derived from — plain data. */
  readonly basis: Readonly<Record<string, unknown>>;
}

export const MIN_PRIORITY_SCORE = 0;
export const MAX_PRIORITY_SCORE = 100;
const MAX_FACTOR_CONTRIBUTION_MAGNITUDE = 100;

/** The one aggregation both writers and readers use: clamped sum. Shared so the engine's computed score and the Today query's re-derived score cannot drift. */
export function aggregatePriorityContributions(contributions: readonly number[]): number {
  return Math.min(
    MAX_PRIORITY_SCORE,
    Math.max(
      MIN_PRIORITY_SCORE,
      contributions.reduce((sum, contribution) => sum + contribution, 0),
    ),
  );
}

/**
 * Parses one stored `factor_value` back into the engine's persisted shape.
 * Only the engine writes these rows and it validates every contribution
 * before persisting, so a malformed value is a defect (a foreign writer or
 * a corrupted row), refused loudly rather than silently scored as zero.
 */
export function parseStoredPriorityFactorValue(
  candidateId: Uuid,
  factorKind: RecommendationPriorityFactorKind,
  factorValue: unknown,
): StoredPriorityFactorValue {
  const defect = (): InternalError =>
    new InternalError(
      'tasks_recommendations.recommendation_priority_factor.value_malformed',
      `Candidate '${candidateId}' factor '${factorKind}' does not hold the engine's { contribution, basis } shape.`,
    );

  if (typeof factorValue !== 'object' || factorValue === null || Array.isArray(factorValue)) {
    throw defect();
  }
  const { contribution, basis } = factorValue as { contribution?: unknown; basis?: unknown };
  if (
    typeof contribution !== 'number' ||
    !Number.isInteger(contribution) ||
    Math.abs(contribution) > MAX_FACTOR_CONTRIBUTION_MAGNITUDE ||
    typeof basis !== 'object' ||
    basis === null ||
    Array.isArray(basis)
  ) {
    throw defect();
  }

  return { contribution, basis: basis as Readonly<Record<string, unknown>> };
}

/**
 * Re-derives a candidate's explainable priority score from its STORED
 * factor rows — the Today ordering's single input ("The application stores
 * the factors needed to explain rank", section 7). A candidate with no
 * factor rows scores `MIN_PRIORITY_SCORE`: no stored factor explains any
 * rank above the floor.
 */
export function derivePriorityScoreFromStoredFactors(
  candidateId: Uuid,
  factors: readonly RecommendationPriorityFactor[],
): number {
  return aggregatePriorityContributions(
    factors.map(
      (factor) =>
        parseStoredPriorityFactorValue(candidateId, factor.factorKind, factor.factorValue)
          .contribution,
    ),
  );
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
