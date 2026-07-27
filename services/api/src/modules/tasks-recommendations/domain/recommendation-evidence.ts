/**
 * Structured recommendation evidence: one row per fact that justified a
 * candidate, speaking section 4's input list as a closed vocabulary.
 *
 * Append-only and immutable — "Presentation does not overwrite generation
 * evidence" (recommendations-and-ai.md, section 6) — so, like
 * `observations_history.observation`, no update function exists here.
 * The at-least-one-row requirement (section 19's "Every recommendation
 * references structured evidence") is enforced in TWO places on purpose:
 * physically by the migration's deferred composite FK
 * (`recommendation_candidate_primary_evidence_fkey` — an evidence-free
 * candidate cannot exist in a committed database state), and one level up
 * by `createRecommendationCandidate`'s own non-empty-evidence validation,
 * the same "clean ValidationError instead of a raw constraint violation"
 * split every consistency CHECK in this module already follows.
 *
 * Source: migrations/1785600000000_recommendations-baseline.sql,
 * `tasks_recommendations.recommendation_evidence`;
 * architecture/recommendations-and-ai.md, sections "4. Structured Inputs"
 * and "10. Explanation Generation".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';

/**
 * Section 4's bullets one-to-one — see the migration's own comment for the
 * full mapping. The list's "Horticultural rule and content versions"
 * bullet is deliberately NOT a kind here: the candidate pins it as
 * `ruleVersionId`, and duplicating it as evidence would state one fact in
 * two places.
 *
 * `seasonal_calendar` (P9D-SEASON-RULES-01): purely additive, alongside the
 * already-reserved `garden_context`/`soil_moisture`/`geometry_exposure` —
 * a context kind with no backing table row of its own (the reviewed
 * `taxonomy_seasonal_fact` row it quotes is snapshotted into `factValue`,
 * the same "value snapshot, not a live reference" posture every other
 * context kind here already takes), so it needs no new structured
 * reference column and no new branch in
 * `validateEvidenceReferenceConsistency` below — the existing "any kind
 * not named above must carry no reference" fallback already covers it
 * correctly. `migrations/1787200000000_seasonal-calendar-evidence-kind.sql`
 * widens the two database CHECKs (`recommendation_evidence_kind_check`,
 * `recommendation_evidence_reference_consistency_check`) to match.
 */
export type RecommendationEvidenceKind =
  | 'plant_identity'
  | 'garden_context'
  | 'weather'
  | 'soil_moisture'
  | 'observation'
  | 'task'
  | 'lifecycle_stage'
  | 'geometry_exposure'
  | 'user_preference'
  | 'seasonal_calendar';

export interface RecommendationEvidence {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly kind: RecommendationEvidenceKind;
  /** Set only for `kind: 'observation'`. */
  readonly sourceObservationId: Uuid | null;
  /** Set only for `kind: 'task'`. */
  readonly sourceTaskId: Uuid | null;
  /** Set only for `kind: 'plant_identity' | 'lifecycle_stage'`. */
  readonly sourcePlantId: Uuid | null;
  /** Set only for `kind: 'weather'`. References `integrations.weather_record` — the FK P7-DATA-01 deferred, closed by P7-INT-01's migration (1785700000000_integrations-weather-baseline.sql). */
  readonly sourceWeatherRecordId: Uuid | null;
  /** Section 10's "stable fact identifiers" — required on every row. */
  readonly factKey: string;
  /** Value snapshot at generation time; `null` for reference kinds whose referenced row IS the value. Never invented: "Missing facts remain missing" (section 4). */
  readonly factValue: unknown;
  readonly createdAt: Date;
}

/** The per-item shape `createRecommendationCandidate` accepts before the owning candidate id and timestamp exist. */
export interface NewRecommendationEvidence {
  readonly id: Uuid;
  readonly kind: RecommendationEvidenceKind;
  readonly sourceObservationId: Uuid | null;
  readonly sourceTaskId: Uuid | null;
  readonly sourcePlantId: Uuid | null;
  readonly sourceWeatherRecordId: Uuid | null;
  readonly rawFactKey: string;
  readonly factValue: unknown;
}

const MAX_FACT_KEY_LENGTH = 200;

function evidenceValidationError(code: string, message: string, index: number): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer: `/evidence/${String(index)}` }],
  });
}

/** Trims and validates a fact key — the same all-spaces gap `validateRuleKey` closes for its own non-blank CHECK. */
function validateFactKey(rawFactKey: string, index: number): string {
  const factKey = rawFactKey.trim();

  if (factKey.length === 0) {
    throw evidenceValidationError(
      'tasks_recommendations.recommendation_evidence.fact_key.blank',
      'evidence factKey must not be blank.',
      index,
    );
  }

  if (factKey.length > MAX_FACT_KEY_LENGTH) {
    throw evidenceValidationError(
      'tasks_recommendations.recommendation_evidence.fact_key.too_long',
      `evidence factKey must be at most ${String(MAX_FACT_KEY_LENGTH)} characters.`,
      index,
    );
  }

  return factKey;
}

/**
 * Mirrors the migration's
 * `recommendation_evidence_reference_consistency_check` one level up, at
 * the point a clean `ValidationError` can still be raised — the same
 * judgment `validateTaskTarget` documents for its own database-mirroring
 * check: each kind carries exactly the structured reference it can have,
 * and context kinds (which have no backing table) carry none.
 */
export function validateEvidenceReferenceConsistency(
  item: NewRecommendationEvidence,
  index: number,
): void {
  const references = {
    observation: item.sourceObservationId,
    task: item.sourceTaskId,
    plant: item.sourcePlantId,
    weather: item.sourceWeatherRecordId,
  };

  const requiredReference: keyof typeof references | null =
    item.kind === 'observation'
      ? 'observation'
      : item.kind === 'task'
        ? 'task'
        : item.kind === 'plant_identity' || item.kind === 'lifecycle_stage'
          ? 'plant'
          : item.kind === 'weather'
            ? 'weather'
            : null;

  const consistent = Object.entries(references).every(([name, value]) =>
    name === requiredReference ? value !== null : value === null,
  );

  if (!consistent) {
    throw evidenceValidationError(
      'tasks_recommendations.recommendation_evidence.reference.inconsistent',
      requiredReference === null
        ? `evidence of kind '${item.kind}' must set no source reference.`
        : `evidence of kind '${item.kind}' must set exactly its own '${requiredReference}' source reference and no other.`,
      index,
    );
  }
}

/**
 * Validates one incoming evidence item and binds it to its owning
 * candidate — called only by `createRecommendationCandidate`, which owns
 * the surrounding non-empty-list rule.
 */
export function buildRecommendationEvidence(
  item: NewRecommendationEvidence,
  index: number,
  candidateId: Uuid,
  now: Date,
): RecommendationEvidence {
  validateEvidenceReferenceConsistency(item, index);

  return {
    id: item.id,
    candidateId,
    kind: item.kind,
    sourceObservationId: item.sourceObservationId,
    sourceTaskId: item.sourceTaskId,
    sourcePlantId: item.sourcePlantId,
    sourceWeatherRecordId: item.sourceWeatherRecordId,
    factKey: validateFactKey(item.rawFactKey, index),
    factValue: item.factValue,
    createdAt: now,
  };
}
