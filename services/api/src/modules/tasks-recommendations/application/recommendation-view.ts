/**
 * Maps stored recommendation candidates to the shapes the Today query and
 * the recommendation commands return — the `task-view.ts` convention: one
 * fixed resource shape per surface, because the idempotency store replays
 * the literal cached response.
 *
 * `RecommendationResource` is the command-response summary (FR-24's fields
 * minus the per-item detail lists); `TodayRecommendationResource` extends
 * it with what the Today view alone renders — the proposed action, the
 * re-derived priority score with its stored factors ("reason, urgency,
 * uncertainty, and controls": uncertainty is the `confidence` factor and
 * any stale-weather labeling inside factor bases and evidence values), the
 * structured evidence references, and the resolved target display name.
 *
 * `explanation` is non-null on every resource deliberately: commands act
 * only on presented candidates and Today reads only `eligible`/`presented`
 * rows, and the migration's presentable-explanation CHECK guarantees the
 * text exists for exactly those states — a `null` here is a defect,
 * refused loudly rather than serialized.
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import type { RecommendationCandidate } from '../domain/recommendation-candidate.js';
import type { RecommendationEvidence } from '../domain/recommendation-evidence.js';
import type { RecommendationPriorityFactor } from '../domain/recommendation-priority.js';
import { parseStoredPriorityFactorValue } from '../domain/recommendation-priority.js';

export interface RecommendationResource {
  readonly id: string;
  readonly gardenId: string;
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly careCategory: string;
  readonly safetyTier: string;
  readonly state: string;
  readonly urgency: string;
  readonly targetKind: string;
  readonly targetGardenAreaMapObjectId: string | null;
  readonly targetPlantId: string | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly explanation: string;
  readonly supersedesCandidateId: string | null;
  readonly presentedAt: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecommendationEvidenceResource {
  readonly id: string;
  readonly kind: string;
  readonly sourceObservationId: string | null;
  readonly sourceTaskId: string | null;
  readonly sourcePlantId: string | null;
  readonly sourceWeatherRecordId: string | null;
  readonly factKey: string;
  readonly factValue: unknown;
}

export interface RecommendationPriorityFactorResource {
  readonly kind: string;
  readonly contribution: number;
  readonly basis: Readonly<Record<string, unknown>>;
}

export interface TodayRecommendationResource extends RecommendationResource {
  /** The rule version's `actionTitle` — FR-24's "Proposed action", resolved from the catalog by the stored (ruleKey, ruleVersion). */
  readonly actionTitle: string;
  /**
   * The explanation-source flag (P7-AI-01): `'ai_embellished'` exactly
   * when `embellishedExplanation` is served, `'deterministic'` otherwise
   * — including whenever the kill-switch is off, which restores the
   * baseline response wholesale. `explanation` is ALWAYS the stored
   * deterministic text regardless of this flag; the embellishment is an
   * additional rendering, never a replacement (section 10's fallback
   * guarantee, visible in the contract itself).
   */
  readonly explanationSource: 'deterministic' | 'ai_embellished';
  /** The accepted AI embellishment for this candidate, when one exists AND serving is enabled; `null` otherwise. */
  readonly embellishedExplanation: string | null;
  /** Re-derived from the stored factor rows via the shared aggregation — see `derivePriorityScoreFromStoredFactors`. */
  readonly priorityScore: number;
  readonly priorityFactors: readonly RecommendationPriorityFactorResource[];
  readonly evidence: readonly RecommendationEvidenceResource[];
  /** The target's current display name: the plant's `displayName` for plant targets; `null` for garden targets (the client knows its garden) and — this pass — for garden-area targets, which no launch rule produces (recorded in deferred-capabilities.md). */
  readonly targetDisplayName: string | null;
}

export interface TodayViewResource {
  readonly gardenId: string;
  readonly generatedAt: string;
  readonly items: readonly TodayRecommendationResource[];
}

function requireStoredExplanation(candidate: RecommendationCandidate): string {
  if (candidate.explanation === null) {
    throw new InternalError(
      'tasks_recommendations.recommendation.explanation_missing',
      `Candidate '${candidate.id}' is in state '${candidate.state}' without a stored explanation — the presentable-explanation CHECK should make this impossible.`,
    );
  }
  return candidate.explanation;
}

export function toRecommendationResource(
  candidate: RecommendationCandidate,
  ruleKey: string,
  ruleVersion: number,
): RecommendationResource {
  return {
    id: candidate.id,
    gardenId: candidate.gardenId,
    ruleKey,
    ruleVersion,
    careCategory: candidate.careCategory,
    safetyTier: candidate.safetyTier,
    state: candidate.state,
    urgency: candidate.urgency,
    targetKind: candidate.targetKind,
    targetGardenAreaMapObjectId: candidate.targetGardenAreaMapObjectId,
    targetPlantId: candidate.targetPlantId,
    windowStart: candidate.windowStart === null ? null : candidate.windowStart.toISOString(),
    windowEnd: candidate.windowEnd === null ? null : candidate.windowEnd.toISOString(),
    explanation: requireStoredExplanation(candidate),
    supersedesCandidateId: candidate.supersedesCandidateId,
    presentedAt: candidate.presentedAt === null ? null : candidate.presentedAt.toISOString(),
    revision: candidate.revision,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

export function toEvidenceResource(
  evidence: RecommendationEvidence,
): RecommendationEvidenceResource {
  return {
    id: evidence.id,
    kind: evidence.kind,
    sourceObservationId: evidence.sourceObservationId,
    sourceTaskId: evidence.sourceTaskId,
    sourcePlantId: evidence.sourcePlantId,
    sourceWeatherRecordId: evidence.sourceWeatherRecordId,
    factKey: evidence.factKey,
    factValue: evidence.factValue,
  };
}

export function toPriorityFactorResource(
  factor: RecommendationPriorityFactor,
): RecommendationPriorityFactorResource {
  const value = parseStoredPriorityFactorValue(
    factor.candidateId,
    factor.factorKind,
    factor.factorValue,
  );
  return { kind: factor.factorKind, contribution: value.contribution, basis: value.basis };
}
