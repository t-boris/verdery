/**
 * The recommendation-candidate aggregate: one persisted candidate per
 * garden/area/plant target, pinned to a versioned rule, physically unable
 * to exist without structured evidence, carrying FR-24's own field list
 * (target, urgency, time window) and section 6's lifecycle state.
 *
 * Mirrors `tasks_recommendations.recommendation_candidate` exactly, the
 * way `task.ts` mirrors `tasks_recommendations.task`. `state` transitions
 * live in `recommendation-lifecycle.ts`, mirroring how this module already
 * splits `task-lifecycle.ts` out of `task.ts`; evidence-item validation
 * lives in `recommendation-evidence.ts`. This file owns construction: a
 * candidate and its evidence are created TOGETHER (`createRecommendation-
 * Candidate` returns both), because section 19's "Every recommendation
 * references structured evidence" makes an evidence-free candidate not
 * merely invalid but unrepresentable — the same invariant the migration's
 * deferred composite FK enforces physically at COMMIT.
 *
 * Source: migrations/1785600000000_recommendations-baseline.sql,
 * `tasks_recommendations.recommendation_candidate`;
 * architecture/recommendations-and-ai.md, sections "6. Candidate
 * Lifecycle", "13. Safety Tiers", "19. Completion Criteria";
 * technical-specification.md, section "FR-24: Recommendations".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import {
  DomainRuleViolatedError,
  ValidationError,
} from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  NewRecommendationEvidence,
  RecommendationEvidence,
} from './recommendation-evidence.js';
import { buildRecommendationEvidence } from './recommendation-evidence.js';
import type { RecommendationCandidateState } from './recommendation-lifecycle.js';
import type { RecommendationSafetyTier } from './rule-version.js';
import type { TaskUrgency } from './task.js';

export type RecommendationTargetKind = 'garden' | 'garden_area' | 'plant';

/**
 * The same four levels `task.urgency` speaks, deliberately: P0-PROD-03
 * names "recommendation urgency levels" and "task states" as one glossary,
 * and a candidate a user acts on may become a suggested task (FR-25), so
 * the two columns must share a vocabulary rather than translate.
 */
export type RecommendationUrgency = TaskUrgency;

/**
 * A candidate's target, mirroring the migration's
 * `recommendation_candidate_target_consistency_check` exactly — the same
 * one-of-three shape `TaskTarget` models for tasks, with its own error
 * codes because it guards its own table's constraint.
 */
export interface RecommendationTarget {
  readonly kind: RecommendationTargetKind;
  readonly gardenAreaMapObjectId: Uuid | null;
  readonly plantId: Uuid | null;
}

export interface RecommendationCandidate {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly targetKind: RecommendationTargetKind;
  readonly targetGardenAreaMapObjectId: Uuid | null;
  readonly targetPlantId: Uuid | null;
  /** Required but not vocabulary-checked: P0-PROD-03's "initial care categories" is a still-undecided product selection — see the migration's own comment on this column. */
  readonly careCategory: string;
  readonly ruleVersionId: Uuid;
  /** Always the referenced rule version's own tier — the migration's composite FK makes a mismatched pair uninsertable — and never `'restricted'`, per `requireGeneratableSafetyTier`. */
  readonly safetyTier: RecommendationSafetyTier;
  readonly state: RecommendationCandidateState;
  readonly urgency: RecommendationUrgency;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
  /** The designated first evidence row — the domain half of the migration's deferred `recommendation_candidate_primary_evidence_fkey`. */
  readonly primaryEvidenceId: Uuid;
  /** Section 6's "A superseding recommendation references the prior record": the NEWER candidate points backward, the `derived_from_media_id`/`corrects_observation_id` direction. */
  readonly supersedesCandidateId: Uuid | null;
  /** Set exactly once, by the `presented` transition; see `recommendation-lifecycle.ts`. */
  readonly presentedAt: Date | null;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const MAX_CARE_CATEGORY_LENGTH = 100;

/** Enforces the migration's target-consistency CHECK one level up — the same judgment `validateTaskTarget` documents for the task table's identical constraint. */
export function validateRecommendationTarget(target: RecommendationTarget): RecommendationTarget {
  const consistent =
    (target.kind === 'garden' &&
      target.gardenAreaMapObjectId === null &&
      target.plantId === null) ||
    (target.kind === 'garden_area' &&
      target.gardenAreaMapObjectId !== null &&
      target.plantId === null) ||
    (target.kind === 'plant' && target.plantId !== null && target.gardenAreaMapObjectId === null);

  if (!consistent) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      "target must set gardenAreaMapObjectId only for kind 'garden_area', plantId only for kind 'plant', and neither for kind 'garden'.",
      {
        details: [
          {
            code: 'tasks_recommendations.recommendation_candidate.target.inconsistent',
            pointer: '/target',
          },
        ],
      },
    );
  }

  return target;
}

/** Trims and validates a care category — non-blank like the migration's CHECK, plus the all-spaces/length gaps every required-text validator in this module closes. */
export function validateCareCategory(rawCareCategory: string): string {
  const careCategory = rawCareCategory.trim();

  if (careCategory.length === 0) {
    throw new ValidationError(SharedErrorCode.RequestInvalid, 'careCategory must not be blank.', {
      details: [
        {
          code: 'tasks_recommendations.recommendation_candidate.care_category.blank',
          pointer: '/careCategory',
        },
      ],
    });
  }

  if (careCategory.length > MAX_CARE_CATEGORY_LENGTH) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      `careCategory must be at most ${String(MAX_CARE_CATEGORY_LENGTH)} characters.`,
      {
        details: [
          {
            code: 'tasks_recommendations.recommendation_candidate.care_category.too_long',
            pointer: '/careCategory',
          },
        ],
      },
    );
  }

  return careCategory;
}

/** Mirrors the migration's `recommendation_candidate_window_check`: a validity window that ends before it starts can never be satisfied. */
export function validateRecommendationWindow(
  windowStart: Date | null,
  windowEnd: Date | null,
): void {
  if (windowStart !== null && windowEnd !== null && windowStart.getTime() > windowEnd.getTime()) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'windowStart must not be after windowEnd.',
      {
        details: [
          {
            code: 'tasks_recommendations.recommendation_candidate.window.invalid',
            pointer: '/window',
          },
        ],
      },
    );
  }
}

/**
 * Section 13's restricted-tier exclusion, as a domain rule: "Restricted"
 * guidance "require[s] dedicated policy and may be excluded from generated
 * recommendations" — until that dedicated policy exists, exclusion is the
 * only safe reading, and the migration's
 * `recommendation_candidate_generatable_safety_tier_check` makes the same
 * rule physical. A future policy stage relaxes both together, by explicit
 * decision, never by this function silently widening.
 */
export function requireGeneratableSafetyTier(safetyTier: RecommendationSafetyTier): void {
  if (safetyTier === 'restricted') {
    throw new DomainRuleViolatedError(
      'tasks_recommendations.recommendation_candidate.restricted_tier',
      'A restricted-tier rule cannot generate a recommendation candidate.',
    );
  }
}

export interface CreateRecommendationCandidateInput {
  readonly id: Uuid;
  readonly gardenId: Uuid;
  readonly target: RecommendationTarget;
  readonly rawCareCategory: string;
  readonly ruleVersionId: Uuid;
  readonly ruleSafetyTier: RecommendationSafetyTier;
  readonly urgency: RecommendationUrgency;
  readonly windowStart: Date | null;
  readonly windowEnd: Date | null;
  readonly supersedesCandidateId: Uuid | null;
  /** At least one item — see `createRecommendationCandidate`'s own doc comment. */
  readonly evidence: readonly NewRecommendationEvidence[];
  readonly now: Date;
}

/** A candidate and its evidence rows, created together — the two halves of one atomic insert (the migration's deferred FK is checked at COMMIT across both). */
export interface RecommendationCandidateAggregate {
  readonly candidate: RecommendationCandidate;
  readonly evidence: readonly RecommendationEvidence[];
}

/**
 * Constructs a new, always-`'generated'` candidate together with its
 * evidence rows. The evidence list must be non-empty: section 19's "Every
 * recommendation references structured evidence" is modeled so the
 * evidence-free case is rejected here with a clean `ValidationError` and
 * rejected again physically by the migration's deferred composite FK —
 * belt and suspenders on the phase's one load-bearing constraint. The
 * first evidence item becomes `primaryEvidenceId`.
 */
export function createRecommendationCandidate(
  input: CreateRecommendationCandidateInput,
): RecommendationCandidateAggregate {
  const target = validateRecommendationTarget(input.target);
  validateRecommendationWindow(input.windowStart, input.windowEnd);
  requireGeneratableSafetyTier(input.ruleSafetyTier);

  if (input.supersedesCandidateId === input.id) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'A candidate cannot supersede itself.',
      {
        details: [
          {
            code: 'tasks_recommendations.recommendation_candidate.self_supersession',
            pointer: '/supersedesCandidateId',
          },
        ],
      },
    );
  }

  const [firstEvidence] = input.evidence;
  if (firstEvidence === undefined) {
    throw new ValidationError(
      SharedErrorCode.RequestInvalid,
      'A recommendation candidate requires at least one evidence item.',
      {
        details: [
          {
            code: 'tasks_recommendations.recommendation_candidate.evidence.missing',
            pointer: '/evidence',
          },
        ],
      },
    );
  }

  const evidence = input.evidence.map((item, index) =>
    buildRecommendationEvidence(item, index, input.id, input.now),
  );

  return {
    candidate: {
      id: input.id,
      gardenId: input.gardenId,
      targetKind: target.kind,
      targetGardenAreaMapObjectId: target.gardenAreaMapObjectId,
      targetPlantId: target.plantId,
      careCategory: validateCareCategory(input.rawCareCategory),
      ruleVersionId: input.ruleVersionId,
      safetyTier: input.ruleSafetyTier,
      state: 'generated',
      urgency: input.urgency,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      primaryEvidenceId: firstEvidence.id,
      supersedesCandidateId: input.supersedesCandidateId,
      presentedAt: null,
      revision: 1,
      createdAt: input.now,
      updatedAt: input.now,
    },
    evidence,
  };
}
