/**
 * The AI-explanation record (P7-AI-01) — recommendations-and-ai.md
 * section 10's "final record", the shape P7-BE-01's explanation column
 * deliberately left to this stage: per candidate and locale, the
 * provider/model/prompt-template provenance, the evidence references
 * sent (fact keys — the minimal packet's stable identifiers), the
 * generated text, and the validation outcome. The FALLBACK deterministic
 * text is NOT duplicated here: it is the candidate row's own
 * `explanation`, always present on every embellishable candidate — the
 * record references it through `candidateId` rather than copying it.
 *
 * Mirrors `tasks_recommendations.recommendation_ai_explanation`
 * (migrations/1786100000000_recommendation-ai-explanation.sql) the way
 * `recommendation-candidate.ts` mirrors its table. Rows are append-only
 * verdicts: at most one per (candidate, locale), never updated — a
 * candidate is generated once and its embellishment attempt is a fact
 * about that generation, not mutable state. Only ACCEPTED records are
 * ever served; every other outcome exists for evaluation, observability
 * (section 17's schema-validation-failure / fallback-rate / safety-
 * filter counters read straight off this table), and audit (section 18's
 * "Model-version replay and audit").
 *
 * Source: architecture/recommendations-and-ai.md, sections "9.
 * Structured Output", "10. Explanation Generation", "16. Evaluation and
 * Release", "17. Observability".
 */

import { SharedErrorCode } from '@verdery/api-contracts';
import { ValidationError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { AiExplanationLocale } from '../../integrations/public.js';

export const AI_EXPLANATION_LOCALES: readonly AiExplanationLocale[] = ['en', 'ru'];

/**
 * Section 9's rejection rules plus the two provider-side verdicts, each a
 * stable stored value:
 * - `accepted` — the one servable outcome;
 * - `schema_invalid` — "Fails schema validation";
 * - `provider_safety_blocked` — Vertex's own safety filter refused
 *   (section 17's "Safety-filter outcome");
 * - `unknown_evidence_reference` — "References unknown garden facts"
 *   (a claimed evidence key outside the packet);
 * - `unsupported_action` — "Introduces an unsupported action";
 * - `unsupported_fact` — a quantity no packet fact or baseline states
 *   (the fact-invention half of "References unknown garden facts");
 * - `prohibited_content` — "Contradicts safety filters" / "Contains
 *   prohibited content" (the excluded-category lexicons);
 * - `length_exceeded` — "concise" (section 8) enforced as a hard bound.
 */
export const AI_EXPLANATION_VALIDATION_OUTCOMES = [
  'accepted',
  'schema_invalid',
  'provider_safety_blocked',
  'unknown_evidence_reference',
  'unsupported_action',
  'unsupported_fact',
  'prohibited_content',
  'length_exceeded',
] as const;

export type AiExplanationValidationOutcome = (typeof AI_EXPLANATION_VALIDATION_OUTCOMES)[number];

export type AiExplanationRejectionOutcome = Exclude<AiExplanationValidationOutcome, 'accepted'>;

export interface AiExplanationRecord {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly locale: AiExplanationLocale;
  /** The composition root's name for the active adapter — also its quota-accounting key. */
  readonly providerKey: string;
  /** Section 10's "Model and configuration version" — the model identifier the adapter was configured with. */
  readonly model: string;
  /** Section 10's "Prompt-template version". */
  readonly promptTemplateVersion: number;
  /** Section 10's "Evidence references": the fact keys of the minimal packet sent to the model. */
  readonly packetFactKeys: readonly string[];
  /**
   * Section 10's "Generated text": the accepted embellishment, or the
   * rejected draft/raw output kept for evaluation. `null` when the
   * provider produced no usable text at all (safety block, empty
   * response).
   */
  readonly generatedText: string | null;
  /** Section 10's "Validation outcome". */
  readonly validationOutcome: AiExplanationValidationOutcome;
  readonly createdAt: Date;
}

export interface CreateAiExplanationRecordInput {
  readonly id: Uuid;
  readonly candidateId: Uuid;
  readonly locale: AiExplanationLocale;
  readonly providerKey: string;
  readonly model: string;
  readonly promptTemplateVersion: number;
  readonly packetFactKeys: readonly string[];
  readonly generatedText: string | null;
  readonly validationOutcome: AiExplanationValidationOutcome;
  readonly now: Date;
}

function invalid(code: string, message: string, pointer: string): ValidationError {
  return new ValidationError(SharedErrorCode.RequestInvalid, message, {
    details: [{ code, pointer }],
  });
}

/**
 * Constructs one record, enforcing the migration's CHECKs one level up
 * (the `createRecommendationCandidate` posture): non-blank provenance, a
 * non-empty packet (an evidence-free packet cannot exist — section 19's
 * evidence invariant applies to what was SENT too), non-blank text when
 * present, and text REQUIRED when accepted — an accepted record without
 * its text would serve nothing.
 */
export function createAiExplanationRecord(
  input: CreateAiExplanationRecordInput,
): AiExplanationRecord {
  if (!AI_EXPLANATION_LOCALES.includes(input.locale)) {
    throw invalid(
      'tasks_recommendations.ai_explanation.locale.unknown',
      `locale must be one of: ${AI_EXPLANATION_LOCALES.join(', ')}.`,
      '/locale',
    );
  }
  for (const [field, value] of [
    ['providerKey', input.providerKey],
    ['model', input.model],
  ] as const) {
    if (value.trim().length === 0) {
      throw invalid(
        'tasks_recommendations.ai_explanation.provenance.blank',
        `${field} must not be blank.`,
        `/${field}`,
      );
    }
  }
  if (!Number.isInteger(input.promptTemplateVersion) || input.promptTemplateVersion < 1) {
    throw invalid(
      'tasks_recommendations.ai_explanation.prompt_template_version.invalid',
      'promptTemplateVersion must be a positive integer.',
      '/promptTemplateVersion',
    );
  }
  if (
    input.packetFactKeys.length === 0 ||
    input.packetFactKeys.some((key) => key.trim().length === 0)
  ) {
    throw invalid(
      'tasks_recommendations.ai_explanation.packet_fact_keys.invalid',
      'packetFactKeys must be a non-empty list of non-blank fact keys.',
      '/packetFactKeys',
    );
  }
  const generatedText = input.generatedText?.trim() ?? null;
  if (generatedText !== null && generatedText.length === 0) {
    throw invalid(
      'tasks_recommendations.ai_explanation.generated_text.blank',
      'generatedText must be null or non-blank.',
      '/generatedText',
    );
  }
  if (input.validationOutcome === 'accepted' && generatedText === null) {
    throw invalid(
      'tasks_recommendations.ai_explanation.accepted_without_text',
      'An accepted record must carry the generated text it accepts.',
      '/generatedText',
    );
  }

  return {
    id: input.id,
    candidateId: input.candidateId,
    locale: input.locale,
    providerKey: input.providerKey.trim(),
    model: input.model.trim(),
    promptTemplateVersion: input.promptTemplateVersion,
    packetFactKeys: [...input.packetFactKeys],
    generatedText,
    validationOutcome: input.validationOutcome,
    createdAt: input.now,
  };
}
