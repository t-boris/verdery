/**
 * `EmbellishRecommendationExplanations` (P7-AI-01): the optional Vertex
 * AI bounded-explanation step of recommendations-and-ai.md section 3's
 * pipeline, run ASYNCHRONOUSLY as a phase of the scheduled
 * recommendation-evaluation sweep — deliberately NOT in the Today
 * request path (a user read must never wait on, or spend budget for, a
 * generative call; section 16's latency budget) and deliberately NOT
 * inside the evaluation transaction (provider calls happen outside
 * database transactions, backend-modular-monolith.md section 12).
 *
 * PER RUN: one bounded selection of presentable candidates that carry a
 * deterministic explanation but no verdict yet for the locale
 * (`listEmbellishableCandidateIds` — self-draining, self-retrying for
 * transients; see the repository port's header), then per candidate:
 * build the minimal packet from the candidate's OWN stored content (rule
 * identity, the stored deterministic explanation, the action title
 * resolved from the catalog, the stored evidence facts — nothing else
 * about the garden is ever sent, section 15), one budgeted+deadlined
 * provider call through integrations' `GenerateAiExplanation`, the
 * bounded deterministic validation (`validateAiExplanationDraft`), and
 * one durable verdict row. `quotaExhausted` stops the batch — every
 * later call would consume-and-refuse against the same budget, the
 * weather sweep's own posture — and the stop is named in the result.
 *
 * FAILURE IS ALWAYS FALLBACK: whatever happens here, the candidate's
 * stored deterministic explanation keeps serving ("If generation fails,
 * the deterministic explanation is shown", section 10). This use case
 * can only ever ADD an accepted embellishment; it never touches the
 * candidate row.
 *
 * The runtime locale is `'en'` (see `RUNTIME_EMBELLISHMENT_LOCALE` in
 * `compose-tasks-recommendations.ts`): the stored baseline the
 * embellishment rephrases is English rule content, and no serving
 * surface negotiates a locale yet — Russian runtime generation is a
 * serving-surface decision recorded in deferred-capabilities.md, while
 * the VALIDATION machinery is already bilingual (the fixture harness
 * proves it over both languages).
 *
 * Source: architecture/recommendations-and-ai.md, sections "3.
 * Recommendation Pipeline", "8. Vertex AI Boundary", "9. Structured
 * Output", "10. Explanation Generation", "14. Provider Failure";
 * implementation-plan.md work package P7-AI-01.
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  AiExplanationLocale,
  AiExplanationRequest,
  GenerateAiExplanationResult,
} from '../../integrations/public.js';
import type {
  AiExplanationRejectionOutcome,
  AiExplanationValidationOutcome,
} from '../domain/ai-explanation.js';
import { createAiExplanationRecord } from '../domain/ai-explanation.js';
import { validateAiExplanationDraft } from '../domain/ai-explanation-validation.js';
import type { RecommendationEvidence } from '../domain/recommendation-evidence.js';
import type { RuleCatalog } from '../domain/rule-catalog.js';
import type { StoredCandidateWithRule } from './recommendation-candidate-repository.js';
import type { TasksRecommendationsUnitOfWork } from './tasks-recommendations-unit-of-work.js';

/** Candidates per run — the sibling sweeps' reasoned 25; the call budget bounds provider spend independently. */
export const EMBELLISHMENT_BATCH_LIMIT = 25;

/** The narrow slice of integrations' `GenerateAiExplanation` this use case drives — structural, so tests fake it without the full constructor. */
export interface AiExplanationGenerator {
  execute(request: AiExplanationRequest): Promise<GenerateAiExplanationResult>;
}

export interface EmbellishmentRunResult {
  /** Candidates this run selected for embellishment. */
  readonly candidatesConsidered: number;
  /** Drafts accepted and stored as servable embellishments. */
  readonly accepted: number;
  /** Durable rejections stored (schema, safety, and every semantic-validation outcome), by outcome. */
  readonly rejected: number;
  readonly rejectionOutcomes: Readonly<Partial<Record<AiExplanationValidationOutcome, number>>>;
  /** Transient degradations (timeout, provider failure, no provider) — nothing stored, retried next run. */
  readonly transientFailures: number;
  /** Concurrent-writer losses on the unique (candidate, locale) row — another run already recorded a verdict. */
  readonly lostRaces: number;
  /** `true` when the call budget refused mid-batch and the remainder was left for a later run. */
  readonly stoppedOnQuotaExhaustion: boolean;
}

/** The structural interface the sweep drives — `null` in the sweep means the capability is switched off and the phase does not run at all. */
export interface RecommendationExplanationEmbellisher {
  execute(): Promise<EmbellishmentRunResult>;
}

export class EmbellishRecommendationExplanations implements RecommendationExplanationEmbellisher {
  constructor(
    private readonly unitOfWork: TasksRecommendationsUnitOfWork,
    private readonly catalog: RuleCatalog,
    private readonly generateAiExplanation: AiExplanationGenerator,
    private readonly locale: AiExplanationLocale,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<EmbellishmentRunResult> {
    const now = this.clock.now();

    // One read transaction for the whole selection; the provider calls
    // below run OUTSIDE any transaction, and each verdict write is its
    // own small one.
    const selection = await this.unitOfWork.run(async (context) => {
      const candidateIds = await context.aiExplanations.listEmbellishableCandidateIds(
        this.locale,
        now,
        EMBELLISHMENT_BATCH_LIMIT,
      );
      const stored = await context.recommendationCandidates.findWithRuleByIds(candidateIds);
      const evidence =
        await context.recommendationCandidates.listEvidenceForCandidates(candidateIds);
      return { stored, evidence };
    });

    let accepted = 0;
    let transientFailures = 0;
    let lostRaces = 0;
    let stoppedOnQuotaExhaustion = false;
    const rejectionOutcomes: Partial<Record<AiExplanationValidationOutcome, number>> = {};

    for (const stored of selection.stored) {
      const candidateEvidence = selection.evidence.filter(
        (row) => row.candidateId === stored.candidate.id,
      );
      const request = this.buildRequest(stored, candidateEvidence);

      const result = await this.generateAiExplanation.execute(request);

      if (result.outcome === 'unavailable') {
        if (result.reason === 'quotaExhausted') {
          // Every later candidate would consume-and-refuse against the
          // same exhausted budget — stop and say so, the weather sweep's
          // own quota posture.
          stoppedOnQuotaExhaustion = true;
          break;
        }
        transientFailures += 1;
        continue;
      }

      const verdict = this.toVerdict(result, request);
      const record = createAiExplanationRecord({
        id: generateUuidV7(),
        candidateId: stored.candidate.id,
        locale: this.locale,
        providerKey: result.provenance.providerKey,
        model: result.provenance.model,
        promptTemplateVersion: result.provenance.promptTemplateVersion,
        packetFactKeys: request.evidenceFacts.map((fact) => fact.factKey),
        generatedText: verdict.generatedText,
        validationOutcome: verdict.outcome,
        now: this.clock.now(),
      });

      const inserted = await this.unitOfWork.run((context) =>
        context.aiExplanations.insertIfAbsent(record),
      );
      if (!inserted) {
        // Another run recorded this (candidate, locale) first — the
        // unique index converged the race; count the loss, never error.
        lostRaces += 1;
        continue;
      }
      if (verdict.outcome === 'accepted') {
        accepted += 1;
      } else {
        rejectionOutcomes[verdict.outcome] = (rejectionOutcomes[verdict.outcome] ?? 0) + 1;
      }
    }

    const rejected = Object.values(rejectionOutcomes).reduce((sum, count) => sum + count, 0);
    return {
      candidatesConsidered: selection.stored.length,
      accepted,
      rejected,
      rejectionOutcomes,
      transientFailures,
      lostRaces,
      stoppedOnQuotaExhaustion,
    };
  }

  /** The minimal packet — the candidate's own stored content and nothing else (section 15's "Send only required facts"). */
  private buildRequest(
    stored: StoredCandidateWithRule,
    evidence: readonly RecommendationEvidence[],
  ): AiExplanationRequest {
    const definition = this.catalog.find(stored.ruleKey, stored.ruleVersion);
    if (definition === null) {
      // The catalog keeps every shipped version forever — absence is a
      // release defect, refused loudly (the `GetTodayView` posture).
      throw new InternalError(
        'tasks_recommendations.embellish_explanations.rule_version_unshipped',
        `Candidate '${stored.candidate.id}' pins rule '${stored.ruleKey}' v${String(stored.ruleVersion)}, which this build's catalog does not ship.`,
      );
    }
    const deterministicExplanation = stored.candidate.explanation;
    if (deterministicExplanation === null) {
      // The selection requires a stored explanation; reaching this means
      // the selection contract broke — a defect, not a degradation.
      throw new InternalError(
        'tasks_recommendations.embellish_explanations.baseline_missing',
        `Candidate '${stored.candidate.id}' was selected for embellishment without a stored deterministic explanation.`,
      );
    }
    return {
      ruleKey: stored.ruleKey,
      ruleVersion: stored.ruleVersion,
      actionTitle: definition.actionTitle,
      deterministicExplanation,
      locale: this.locale,
      evidenceFacts: evidence.map((row) => ({ factKey: row.factKey, factValue: row.factValue })),
    };
  }

  /** Maps one non-transient generation result to the verdict its record stores. */
  private toVerdict(
    result: Exclude<GenerateAiExplanationResult, { outcome: 'unavailable' }>,
    request: AiExplanationRequest,
  ): { outcome: AiExplanationValidationOutcome; generatedText: string | null } {
    if (result.outcome === 'schemaInvalid') {
      return { outcome: 'schema_invalid', generatedText: result.rawText };
    }
    if (result.outcome === 'safetyBlocked') {
      return { outcome: 'provider_safety_blocked', generatedText: null };
    }
    const verdict = validateAiExplanationDraft({
      draft: result.draft,
      deterministicExplanation: request.deterministicExplanation,
      actionTitle: request.actionTitle,
      packetFactKeys: request.evidenceFacts.map((fact) => fact.factKey),
      packetFactValues: request.evidenceFacts.map((fact) => fact.factValue),
    });
    if (verdict.verdict === 'accepted') {
      return { outcome: 'accepted', generatedText: verdict.text };
    }
    // The rejected draft's text is kept on the record for evaluation
    // (section 10 stores generated text alongside its outcome) — it is
    // never served.
    const rejection: AiExplanationRejectionOutcome = verdict.verdict;
    return { outcome: rejection, generatedText: result.draft.explanation };
  }
}
