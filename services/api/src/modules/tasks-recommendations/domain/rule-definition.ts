/**
 * The versioned rule model: section 5's own content list ("Eligibility
 * conditions. Required and optional evidence. Time window and recurrence
 * behavior. Priority inputs. Exclusion and safety conditions. Suggested
 * action template. Explanation facts. Regional or plant applicability.
 * Content and reviewer metadata.") as one typed, immutable definition the
 * engine executes deterministically.
 *
 * Safety exclusion is STRUCTURAL, three ways:
 *
 * 1. `safetyTier` is `GeneratableSafetyTier` — the type cannot spell
 *    `'restricted'`, mirroring the candidate table's own
 *    `generatable_safety_tier` CHECK and composite-FK pinning (section 13:
 *    restricted guidance "require[s] dedicated policy and may be excluded
 *    from generated recommendations" — until that policy exists, exclusion
 *    is the only safe reading).
 * 2. `EXCLUDED_RULE_CONTENT_CATEGORIES` names the content categories no
 *    rule may declare — section 13's Restricted list (chemical
 *    application, emergency, legal-boundary, structural, electrical,
 *    medical) plus the Elevated-Risk subjects this launch deliberately
 *    does not attempt (disease diagnosis, toxicity, pest treatment,
 *    fertilizer concentration) — and `validateRuleDefinition` rejects any
 *    rule whose `careCategory` matches one. Widening is a reviewed edit to
 *    this list, never a runtime option.
 * 3. Every candidate a rule produces passes
 *    `requireGeneratableSafetyTier` and the migration's own CHECKs again
 *    at creation time — belt and suspenders on the phase's safety
 *    invariant.
 *
 * Review metadata is honest: no agent can perform a horticultural review,
 * so every launch rule ships `reviewStatus: 'awaiting_horticultural_review'`
 * with `P7-SAFE-01` named as the owning review stage. Approval later edits
 * the metadata of the SAME version — review approves content as it stands,
 * so it deliberately does not participate in the content-version
 * discipline (`launch-rule-catalog.test.ts` documents the hash boundary).
 *
 * Source: architecture/recommendations-and-ai.md, sections "5. Rule
 * Engine" and "13. Safety Tiers"; tasks/todo.md, "Phase 7 ... planning"
 * (the awaiting-review posture).
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { WeatherRecordKind } from '../../integrations/public.js';
import type { GardenFacts } from './garden-facts.js';
import type { RecommendationTarget, RecommendationUrgency } from './recommendation-candidate.js';
import { validateCareCategory } from './recommendation-candidate.js';
import type { RecommendationEvidenceKind } from './recommendation-evidence.js';
import type { RecommendationPriorityFactorKind } from './recommendation-priority.js';
import type { RecommendationSafetyTier } from './rule-version.js';
import { validateRuleKey, validateRuleVersionNumber } from './rule-version.js';

/** The only tiers a rule definition can carry — `'restricted'` is unrepresentable by construction. */
export type GeneratableSafetyTier = Exclude<RecommendationSafetyTier, 'restricted'>;

/**
 * Content categories no rule may declare, normalized to lower snake_case.
 * Section 13's Restricted list verbatim, plus the Elevated-Risk subjects
 * the launch scope structurally refuses (the phase plan's own exclusion
 * list: "chemical, toxicity, pest-treatment, structural, medical,
 * legal-boundary").
 */
export const EXCLUDED_RULE_CONTENT_CATEGORIES: readonly string[] = [
  'chemical_application',
  'disease_diagnosis',
  'electrical',
  'emergency',
  'fertilizer_concentration',
  'legal_boundary',
  'medical',
  'pest_treatment',
  'structural',
  'toxicity',
];

/** Section 5's "Time window and recurrence behavior", in milliseconds relative to the evaluation instant. */
export interface RuleTimingSpec {
  /** How long a produced candidate stays actionable: `windowEnd = evaluatedAt + validityWindowMs` unless the rule derives a fact-based end (`windowEnd` on the eligible outcome). */
  readonly validityWindowMs: number;
  /** The minimum spacing between two candidates for the same (rule, target) once the prior one is resolved — see `rule-evaluation.ts`'s recurrence rule. */
  readonly recurrenceIntervalMs: number;
}

/**
 * How a rule relates to weather facts. `'notUsed'` rules never touch
 * weather. A dependent rule names the record kind it needs and its
 * stale-data posture — external-integrations.md section 11's "Cached stale
 * data is labeled and used only when product rules permit it" makes
 * staleness tolerance a PER-RULE product decision, so it lives here, in
 * versioned reviewed content, not in engine configuration.
 */
export type RuleWeatherPolicy =
  | { readonly use: 'notUsed' }
  | {
      readonly use: 'required';
      readonly kind: WeatherRecordKind;
      /** `'skip'`: stale weather skips the rule entirely. `'useLabeledStale'`: the rule may fire, provided its confidence factor and evidence carry the stale label. */
      readonly whenStale: 'skip' | 'useLabeledStale';
    };

/** Reviewer metadata — section 5's "Content and reviewer metadata", carried honestly (see this file's header). */
export type RuleReviewMetadata =
  | {
      readonly reviewStatus: 'awaiting_horticultural_review';
      /**
       * The work package that owns the outstanding human review. A closed
       * literal union, not `string`: `P7-SAFE-01` is the launch four's own
       * owner; `P9D-SEASON-RULES-01` (P9D-SEASON-RULES-01) is the seasonal
       * three's — every launch rule still names exactly one real,
       * traceable work package, the same honesty the single-literal type
       * enforced before this stage added a second cohort of rules.
       */
      readonly awaitingReviewBy: 'P7-SAFE-01' | 'P9D-SEASON-RULES-01';
    }
  | {
      readonly reviewStatus: 'horticulturally_reviewed';
      readonly reviewedBy: string;
      /** Calendar date of sign-off, `'YYYY-MM-DD'`. */
      readonly reviewedOn: string;
    };

/** One evidence row a rule wants recorded — `NewRecommendationEvidence` before ids exist; the use case assigns ids at persistence time so the pure engine stays id-free. */
export interface RuleEvidenceSpec {
  readonly kind: RecommendationEvidenceKind;
  readonly sourceObservationId: string | null;
  readonly sourceTaskId: string | null;
  readonly sourcePlantId: string | null;
  readonly sourceWeatherRecordId: string | null;
  readonly factKey: string;
  readonly factValue: unknown;
}

/**
 * One priority-factor contribution — the engine's answer to section 7's
 * "score or ordered category" choice: priority is an explainable integer
 * score, the clamped-to-[0,100] sum of per-factor `contribution`s, and the
 * persisted factor value is `{ contribution, basis }` so the stored rows
 * alone reproduce and explain the rank ("The application stores the
 * factors needed to explain rank").
 */
export interface RuleFactorContribution {
  readonly kind: RecommendationPriorityFactorKind;
  /** Integer, may be negative (an overlap penalty), bounded by `validateFactorContribution`. */
  readonly contribution: number;
  /** The named facts this contribution is derived from — plain data, part of the persisted factor value. */
  readonly basis: Readonly<Record<string, unknown>>;
}

/** Why a whole rule produced nothing this evaluation — each a typed degradation, never a silent one (section 18's "Weather staleness" and "Missing ... inputs" test lines). */
export type RuleSkipReason =
  | { readonly kind: 'weatherMissing'; readonly requiredKind: WeatherRecordKind }
  | { readonly kind: 'weatherStale'; readonly requiredKind: WeatherRecordKind }
  /** A fact the rule needs is absent (for example a needed measurement is `null`, or a forecast is not about an upcoming moment). Nothing is invented in its place. */
  | { readonly kind: 'factMissing'; readonly detail: string };

/** One target's evaluation by a rule's own eligibility conditions. */
export type RuleTargetEvaluation =
  | {
      readonly outcome: 'eligible';
      readonly target: RecommendationTarget;
      /** At least one item; must cover the rule's `requiredEvidenceKinds` — `rule-evaluation.ts` enforces both. */
      readonly evidence: readonly RuleEvidenceSpec[];
      /** The rule's own factor contributions. `task_overlap` is engine-owned and must not appear here. */
      readonly factors: readonly RuleFactorContribution[];
      /** Flat scalar facts the explanation template renders from — section 5's "Explanation facts", each derived from the evidence above. */
      readonly explanationFacts: Readonly<Record<string, string | number>>;
      /** A fact-derived window end (for example a forecast's effective moment) overriding `timing.validityWindowMs`; `null` uses the default. */
      readonly windowEnd: Date | null;
    }
  | {
      readonly outcome: 'notEligible';
      readonly target: RecommendationTarget;
      /** A stable, fixture-assertable code such as `'plant.status_not_active'`. */
      readonly reasonCode: string;
    };

/** A rule's whole answer for one garden: either per-target evaluations, or one typed skip. */
export type RuleEvaluation =
  | { readonly outcome: 'evaluated'; readonly targets: readonly RuleTargetEvaluation[] }
  | { readonly outcome: 'skipped'; readonly reason: RuleSkipReason };

/**
 * The eligibility conditions themselves: a pure, deterministic function of
 * the garden's facts. Everything tunable in it must be read from the
 * definition's own `parameters`, so the reviewable data and the executed
 * logic cannot drift apart.
 */
export type RuleEvaluator = (facts: GardenFacts) => RuleEvaluation;

export interface RuleDefinition {
  readonly ruleKey: string;
  readonly version: number;
  readonly safetyTier: GeneratableSafetyTier;
  readonly careCategory: string;
  /** The suggested action, imperative and short — section 5's "Suggested action template". */
  readonly actionTitle: string;
  /** What the rule does and why, for the human reviewer. */
  readonly description: string;
  readonly urgency: RecommendationUrgency;
  readonly timing: RuleTimingSpec;
  readonly weatherPolicy: RuleWeatherPolicy;
  /** Evidence kinds every fired candidate MUST carry — section 5's "Required ... evidence"; kinds emitted beyond these are the optional ones. */
  readonly requiredEvidenceKinds: readonly RecommendationEvidenceKind[];
  /** The deterministic explanation — `{placeholder}`s resolve against the eligible outcome's `explanationFacts`. Always present; AI embellishment (P7-AI-01) may later wrap it but never replaces it (section 10's fallback). */
  readonly explanationTemplate: string;
  /** Every tunable threshold the evaluator consults, as named reviewable data. */
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly review: RuleReviewMetadata;
  readonly evaluate: RuleEvaluator;
}

const MAX_FACTOR_CONTRIBUTION = 100;

function ruleInvalid(ruleKey: string, code: string, message: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer: `/rules/${ruleKey}` }],
  });
}

/** Normalizes a category the way the exclusion list spells its entries, so `'Pest Treatment'` and `'pest-treatment'` cannot slip past an exact comparison. */
export function normalizeContentCategory(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** The explicit structural exclusion: rejects a rule declaring any excluded content category. */
export function requireAllowedContentCategory(ruleKey: string, careCategory: string): void {
  const normalized = normalizeContentCategory(careCategory);
  if (EXCLUDED_RULE_CONTENT_CATEGORIES.includes(normalized)) {
    throw ruleInvalid(
      ruleKey,
      'tasks_recommendations.rule_definition.care_category.excluded',
      `Rule '${ruleKey}' declares excluded content category '${normalized}': this category requires dedicated safety policy (recommendations-and-ai.md section 13) and cannot be expressed as a generated-recommendation rule.`,
    );
  }
}

/** Bounds one factor contribution: an integer within ±100, so no single factor can silently dominate the 0–100 score scale. */
export function validateFactorContribution(ruleKey: string, factor: RuleFactorContribution): void {
  if (
    !Number.isInteger(factor.contribution) ||
    Math.abs(factor.contribution) > MAX_FACTOR_CONTRIBUTION
  ) {
    throw ruleInvalid(
      ruleKey,
      'tasks_recommendations.rule_definition.factor_contribution.invalid',
      `Rule '${ruleKey}' factor '${factor.kind}' contribution must be an integer within ±${String(MAX_FACTOR_CONTRIBUTION)}.`,
    );
  }
}

/**
 * Validates one definition's declarative content. The evaluator function's
 * behavior cannot be validated statically — the fixture suite pins it per
 * version — but everything declared as data is checked here, at catalog
 * construction, so a defective definition fails composition, not a
 * garden's evaluation.
 */
export function validateRuleDefinition(definition: RuleDefinition): RuleDefinition {
  validateRuleKey(definition.ruleKey);
  validateRuleVersionNumber(definition.version);
  validateCareCategory(definition.careCategory);
  requireAllowedContentCategory(definition.ruleKey, definition.careCategory);

  for (const [field, value] of [
    ['validityWindowMs', definition.timing.validityWindowMs],
    ['recurrenceIntervalMs', definition.timing.recurrenceIntervalMs],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw ruleInvalid(
        definition.ruleKey,
        'tasks_recommendations.rule_definition.timing.invalid',
        `Rule '${definition.ruleKey}' timing.${field} must be a positive integer of milliseconds.`,
      );
    }
  }

  for (const [field, text] of [
    ['actionTitle', definition.actionTitle],
    ['description', definition.description],
    ['explanationTemplate', definition.explanationTemplate],
  ] as const) {
    if (text.trim().length === 0) {
      throw ruleInvalid(
        definition.ruleKey,
        'tasks_recommendations.rule_definition.text.blank',
        `Rule '${definition.ruleKey}' ${field} must not be blank.`,
      );
    }
  }

  if (definition.requiredEvidenceKinds.length === 0) {
    throw ruleInvalid(
      definition.ruleKey,
      'tasks_recommendations.rule_definition.required_evidence.missing',
      `Rule '${definition.ruleKey}' must require at least one evidence kind: an evidence-free recommendation is unrepresentable (section 19).`,
    );
  }

  return definition;
}
