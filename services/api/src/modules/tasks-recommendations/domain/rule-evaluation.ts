/**
 * The deterministic rule engine: section 3's pipeline stages that belong
 * to rules — candidate generation, eligibility and safety filters,
 * priority and timing calculation — as one pure function over a garden's
 * facts, the catalog, and the prior evaluation state. Same inputs, same
 * output, always: no clock read (the evaluation instant is a fact), no
 * randomness, no id generation (ids are assigned at persistence time), no
 * IO.
 *
 * Phase order per eligible target, and what each phase means:
 *
 * 1. WEATHER GATE (engine-owned): a weather-dependent rule whose record is
 *    absent skips with `weatherMissing` ("Missing facts remain missing" —
 *    with no provider configured, today's honest reality, every
 *    weather-dependent rule skips). A stale record skips or proceeds
 *    labeled per the RULE's own declared stale policy — see
 *    `RuleWeatherPolicy` for the section-11 grounding.
 * 2. ELIGIBILITY (rule-owned): the versioned evaluator's own conditions.
 * 3. DUPLICATE SUPPRESSION (engine-owned) — equivalence is defined
 *    honestly, narrowly, and in this order:
 *    a. An OPEN task provably addressing the same work — provable ONLY
 *       through `task.origin_recommendation_id` resolving to this same
 *       rule key and target. A manual task's equivalence is undecidable
 *       (tasks carry free-text titles and no care-category vocabulary —
 *       P0-PROD-03 is undecided), so manual overlap NEVER suppresses; it
 *       contributes the `task_overlap` priority penalty instead, which is
 *       exactly where section 7 places "Existing task overlap".
 *    b. A LIVE candidate for the same (rule key, target) that is still
 *       current — same rule version, validity window not passed —
 *       suppresses regeneration: re-running an evaluation over unchanged
 *       facts is a no-op, which is what makes the use case idempotent.
 *    c. A live candidate that is STALE — produced by an older rule
 *       version, or with its validity window passed while the condition
 *       persists — is SUPERSEDED: the new candidate carries
 *       `supersedesCandidateId` backward (section 6's own direction) and
 *       the prior transitions to `superseded`.
 * 4. RECURRENCE TIMING (engine-owned): when no live candidate exists, the
 *    most recent candidate for the same (rule key, target) — typically a
 *    resolved one — suppresses regeneration until the rule's
 *    `recurrenceIntervalMs` has elapsed since its creation, so a completed
 *    or rejected recommendation is not immediately re-nagged. Supersession
 *    of a stale live candidate is deliberately exempt: replacing is not
 *    repeating.
 * 5. PRIORITY (engine-owned scale, rule-owned inputs): the explainable
 *    integer score in [0, 100] — the sum of factor contributions, clamped
 *    — with every contributing factor persisted as `{ contribution,
 *    basis }` rows. `task_overlap` is computed here, never by a rule.
 * 6. EXPLANATION: the deterministic template rendering, always present.
 *
 * A defect in a rule implementation (missing required evidence, duplicate
 * factor kinds, a target evaluated twice) throws `InternalError` loudly —
 * a defective rule must fail the evaluation, not persist a malformed
 * candidate.
 *
 * Source: architecture/recommendations-and-ai.md, sections "3.
 * Recommendation Pipeline", "5. Rule Engine", "6. Candidate Lifecycle",
 * "7. Priority", "17. Observability" (duplication and freshness).
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  GardenFacts,
  PriorCandidateFact,
  PriorRecommendationState,
  WeatherFact,
} from './garden-facts.js';
import { sameRecommendationTarget } from './garden-facts.js';
import type { RecommendationTarget, RecommendationUrgency } from './recommendation-candidate.js';
import type {
  GeneratableSafetyTier,
  RuleDefinition,
  RuleEvidenceSpec,
  RuleFactorContribution,
  RuleSkipReason,
} from './rule-definition.js';
import { validateFactorContribution } from './rule-definition.js';
import type { RuleCatalog } from './rule-catalog.js';
import { renderRuleExplanation } from './rule-explanation.js';

/**
 * The engine-owned overlap penalty: open tasks on the same target that did
 * NOT prove equivalence (manual tasks, or conversions of other rules)
 * lower the score without suppressing — work already on the user's list
 * makes a same-target recommendation less pressing, not wrong. The scale
 * is the engine's decision (section 7 leaves score semantics to the
 * application); the basis rows carry the overlapping task ids so the
 * penalty stays explainable.
 */
export const TASK_OVERLAP_CONTRIBUTION = -15;

const MIN_PRIORITY_SCORE = 0;
const MAX_PRIORITY_SCORE = 100;

export type SuppressionReason =
  | { readonly kind: 'openTaskExists'; readonly taskId: Uuid }
  | { readonly kind: 'liveCandidateExists'; readonly candidateId: Uuid }
  | {
      readonly kind: 'withinRecurrenceInterval';
      readonly priorCandidateId: Uuid;
      readonly priorCreatedAt: Date;
    };

/** The full decision trace, one entry per rule (skips) or per rule-target pair — what fixtures assert and observability counts. */
export type RuleDecision =
  | {
      readonly kind: 'ruleSkipped';
      readonly ruleKey: string;
      readonly ruleVersion: number;
      readonly reason: RuleSkipReason;
    }
  | {
      readonly kind: 'targetNotEligible';
      readonly ruleKey: string;
      readonly ruleVersion: number;
      readonly target: RecommendationTarget;
      readonly reasonCode: string;
    }
  | {
      readonly kind: 'targetSuppressed';
      readonly ruleKey: string;
      readonly ruleVersion: number;
      readonly target: RecommendationTarget;
      readonly reason: SuppressionReason;
    }
  | {
      readonly kind: 'fire';
      readonly ruleKey: string;
      readonly ruleVersion: number;
      readonly target: RecommendationTarget;
      readonly priorityScore: number;
      readonly supersedesCandidateId: Uuid | null;
    };

/** Everything persistence needs to materialize one new candidate — ids deliberately absent (assigned by the use case), decisions independent of them. */
export interface PlannedCandidate {
  readonly ruleKey: string;
  readonly ruleVersion: number;
  readonly safetyTier: GeneratableSafetyTier;
  readonly careCategory: string;
  readonly target: RecommendationTarget;
  readonly urgency: RecommendationUrgency;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly evidence: readonly RuleEvidenceSpec[];
  readonly factors: readonly RuleFactorContribution[];
  readonly priorityScore: number;
  /** The rendered deterministic explanation — always present, the section-10 baseline. */
  readonly explanation: string;
  /** The stale live candidate this one replaces, with the revision guard its `superseded` transition must be written under. */
  readonly supersedes: { readonly candidateId: Uuid; readonly expectedRevision: number } | null;
}

export interface GardenRuleEvaluationPlan {
  readonly decisions: readonly RuleDecision[];
  /** Aligned one-to-one, in order, with the `'fire'` decisions above. */
  readonly plannedCandidates: readonly PlannedCandidate[];
}

function ruleDefect(ruleKey: string, message: string): InternalError {
  return new InternalError(
    'tasks_recommendations.rule_evaluation.rule_defect',
    `Rule '${ruleKey}' is defective: ${message}`,
  );
}

/** The engine-owned weather gate — phase 1 in this file's header. `null` means the gate passes. */
function weatherGateSkip(rule: RuleDefinition, facts: GardenFacts): RuleSkipReason | null {
  if (rule.weatherPolicy.use === 'notUsed') {
    return null;
  }
  const fact: WeatherFact =
    rule.weatherPolicy.kind === 'observation' ? facts.weatherObservation : facts.weatherForecast;
  if (fact.availability === 'missing') {
    return { kind: 'weatherMissing', requiredKind: rule.weatherPolicy.kind };
  }
  if (fact.freshness === 'stale' && rule.weatherPolicy.whenStale === 'skip') {
    return { kind: 'weatherStale', requiredKind: rule.weatherPolicy.kind };
  }
  return null;
}

/** Defect checks over one eligible outcome — see this file's header for why these throw instead of degrading. */
function requireWellFormedEligibility(
  rule: RuleDefinition,
  evidence: readonly RuleEvidenceSpec[],
  factors: readonly RuleFactorContribution[],
): void {
  if (evidence.length === 0) {
    throw ruleDefect(rule.ruleKey, 'an eligible target carries no evidence.');
  }
  const emittedKinds = new Set(evidence.map((item) => item.kind));
  for (const requiredKind of rule.requiredEvidenceKinds) {
    if (!emittedKinds.has(requiredKind)) {
      throw ruleDefect(
        rule.ruleKey,
        `an eligible target is missing required evidence kind '${requiredKind}'.`,
      );
    }
  }
  const seenFactorKinds = new Set<string>();
  for (const factor of factors) {
    if (factor.kind === 'task_overlap') {
      throw ruleDefect(rule.ruleKey, "the 'task_overlap' factor is engine-owned.");
    }
    if (seenFactorKinds.has(factor.kind)) {
      throw ruleDefect(rule.ruleKey, `factor kind '${factor.kind}' is contributed twice.`);
    }
    seenFactorKinds.add(factor.kind);
    validateFactorContribution(rule.ruleKey, factor);
  }
}

/** The most recently created entry among `candidates` matching (rule key, target), or `null`. */
function latestMatching(
  candidates: readonly PriorCandidateFact[],
  ruleKey: string,
  target: RecommendationTarget,
): PriorCandidateFact | null {
  let latest: PriorCandidateFact | null = null;
  for (const candidate of candidates) {
    if (candidate.ruleKey !== ruleKey || !sameRecommendationTarget(candidate.target, target)) {
      continue;
    }
    if (latest === null || candidate.createdAt.getTime() > latest.createdAt.getTime()) {
      latest = candidate;
    }
  }
  return latest;
}

/** A live candidate is still current when it speaks the rule's present version and its validity window has not passed (inclusive end). */
function isCurrent(
  candidate: PriorCandidateFact,
  rule: RuleDefinition,
  evaluatedAt: Date,
): boolean {
  return (
    candidate.ruleVersion === rule.version &&
    (candidate.windowEnd === null || candidate.windowEnd.getTime() >= evaluatedAt.getTime())
  );
}

/** Evaluates every active rule against one garden — the pure heart of `EvaluateGardenRecommendations`. See this file's header for the phase semantics. */
export function evaluateGardenRules(
  catalog: RuleCatalog,
  facts: GardenFacts,
  prior: PriorRecommendationState,
): GardenRuleEvaluationPlan {
  const decisions: RuleDecision[] = [];
  const plannedCandidates: PlannedCandidate[] = [];

  for (const rule of catalog.activeRules()) {
    const gateSkip = weatherGateSkip(rule, facts);
    if (gateSkip !== null) {
      decisions.push({
        kind: 'ruleSkipped',
        ruleKey: rule.ruleKey,
        ruleVersion: rule.version,
        reason: gateSkip,
      });
      continue;
    }

    const evaluation = rule.evaluate(facts);
    if (evaluation.outcome === 'skipped') {
      decisions.push({
        kind: 'ruleSkipped',
        ruleKey: rule.ruleKey,
        ruleVersion: rule.version,
        reason: evaluation.reason,
      });
      continue;
    }

    const seenTargets: RecommendationTarget[] = [];
    for (const targetEvaluation of evaluation.targets) {
      const { target } = targetEvaluation;
      if (seenTargets.some((seen) => sameRecommendationTarget(seen, target))) {
        throw ruleDefect(rule.ruleKey, 'the same target was evaluated twice.');
      }
      seenTargets.push(target);

      if (targetEvaluation.outcome === 'notEligible') {
        decisions.push({
          kind: 'targetNotEligible',
          ruleKey: rule.ruleKey,
          ruleVersion: rule.version,
          target,
          reasonCode: targetEvaluation.reasonCode,
        });
        continue;
      }

      requireWellFormedEligibility(rule, targetEvaluation.evidence, targetEvaluation.factors);

      const suppressed = (reason: SuppressionReason): void => {
        decisions.push({
          kind: 'targetSuppressed',
          ruleKey: rule.ruleKey,
          ruleVersion: rule.version,
          target,
          reason,
        });
      };

      // 3a. Provably equivalent open task.
      const equivalentTask = facts.openTasks.find(
        (task) =>
          task.originRuleKey === rule.ruleKey && sameRecommendationTarget(task.target, target),
      );
      if (equivalentTask !== undefined) {
        suppressed({ kind: 'openTaskExists', taskId: equivalentTask.taskId });
        continue;
      }

      // 3b/3c. Live candidate: current suppresses, stale is superseded.
      const liveCandidate = latestMatching(prior.liveCandidates, rule.ruleKey, target);
      let supersedes: PlannedCandidate['supersedes'] = null;
      if (liveCandidate !== null) {
        if (isCurrent(liveCandidate, rule, facts.evaluatedAt)) {
          suppressed({ kind: 'liveCandidateExists', candidateId: liveCandidate.candidateId });
          continue;
        }
        supersedes = {
          candidateId: liveCandidate.candidateId,
          expectedRevision: liveCandidate.revision,
        };
      } else {
        // 4. Recurrence timing, only when nothing is being replaced.
        const latest = latestMatching(prior.latestPerRuleAndTarget, rule.ruleKey, target);
        if (
          latest !== null &&
          facts.evaluatedAt.getTime() - latest.createdAt.getTime() <
            rule.timing.recurrenceIntervalMs
        ) {
          suppressed({
            kind: 'withinRecurrenceInterval',
            priorCandidateId: latest.candidateId,
            priorCreatedAt: latest.createdAt,
          });
          continue;
        }
      }

      // 5. Priority: rule contributions plus the engine-owned overlap penalty.
      const overlappingTasks = facts.openTasks.filter((task) =>
        sameRecommendationTarget(task.target, target),
      );
      const factors: RuleFactorContribution[] = [...targetEvaluation.factors];
      if (overlappingTasks.length > 0) {
        factors.push({
          kind: 'task_overlap',
          contribution: TASK_OVERLAP_CONTRIBUTION,
          basis: { openTaskIds: overlappingTasks.map((task) => task.taskId) },
        });
      }
      const priorityScore = Math.min(
        MAX_PRIORITY_SCORE,
        Math.max(
          MIN_PRIORITY_SCORE,
          factors.reduce((sum, factor) => sum + factor.contribution, 0),
        ),
      );

      // 6. Timing window and the always-present deterministic explanation.
      const windowStart = facts.evaluatedAt;
      const windowEnd =
        targetEvaluation.windowEnd ??
        new Date(facts.evaluatedAt.getTime() + rule.timing.validityWindowMs);
      if (windowEnd.getTime() <= windowStart.getTime()) {
        throw ruleDefect(rule.ruleKey, 'a derived validity window ends at or before its start.');
      }
      const explanation = renderRuleExplanation(
        rule.ruleKey,
        rule.explanationTemplate,
        targetEvaluation.explanationFacts,
      );

      decisions.push({
        kind: 'fire',
        ruleKey: rule.ruleKey,
        ruleVersion: rule.version,
        target,
        priorityScore,
        supersedesCandidateId: supersedes?.candidateId ?? null,
      });
      plannedCandidates.push({
        ruleKey: rule.ruleKey,
        ruleVersion: rule.version,
        safetyTier: rule.safetyTier,
        careCategory: rule.careCategory,
        target,
        urgency: rule.urgency,
        windowStart,
        windowEnd,
        evidence: targetEvaluation.evidence,
        factors,
        priorityScore,
        explanation,
        supersedes,
      });
    }
  }

  return { decisions, plannedCandidates };
}
