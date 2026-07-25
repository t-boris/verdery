/**
 * The bounded deterministic validation of an AI explanation draft
 * (P7-AI-01) — recommendations-and-ai.md section 9's rejection rules,
 * implemented so the phase exit criterion "Generated text cannot add
 * unsupported actions or bypass safety filters" is STRUCTURAL: every
 * check below is a pure function of the draft and the candidate's own
 * stored content, works identically over English and Russian text, and
 * resolves every ambiguity toward rejection — the fallback (the stored
 * deterministic explanation) is always correct, so a false rejection
 * costs polish while a false acceptance costs the safety invariant.
 *
 * The checks, in order (first failure wins, one verdict per draft):
 *
 * 1. `length_exceeded` — section 8's "concise" as a hard character
 *    bound (`MAX_EMBELLISHED_EXPLANATION_LENGTH`).
 * 2. `unknown_evidence_reference` — the draft's own claimed
 *    `evidenceKeysUsed` must be a non-empty subset of the packet's fact
 *    keys ("References unknown garden facts", checked against what was
 *    actually sent).
 * 3. `prohibited_content` — the bilingual excluded-category lexicon;
 *    never permitted, regardless of baseline (section 13).
 * 4. `unsupported_action` — every action concept the draft names (both
 *    languages scanned) must already be named by the deterministic
 *    baseline (explanation + action title). The baseline IS the action
 *    vocabulary; the embellishment may restate it, in either language,
 *    but never extend it ("Introduces an unsupported action").
 * 5. `unsupported_fact` — every numeric token in the draft must appear
 *    among the numbers of the baseline, the action title, or the
 *    packet's evidence fact values (decimal comma normalized, so a
 *    Russian "0,5" restates the stored 0.5). A number no fact states is
 *    an invented fact ("Missing facts remain missing", section 4).
 *
 * What this deliberately does NOT attempt: spelled-out numerals ("two
 *    liters", "два литра"), action phrasings outside the lexicon,
 *    section 9's "Exceeds uncertainty rules" (a rephrase that strengthens
 *    the baseline's stated uncertainty — "may be frost-sensitive" into a
 *    certainty — has no lexicon here; the only structural guard is that
 *    the uncertainty wording lives in the baseline the draft is judged
 *    against), and user-supplied text INSIDE the baseline: the plant
 *    display name is embedded in the stored explanation, so an action
 *    word in a name extends the permitted action vocabulary (pinned as an
 *    accepted fixture; prohibited categories and numbers stay enforced
 *    regardless).
 * Those residuals are what section 16's HUMAN evaluation pass reviews —
 * named in `tests/ai-explanation-fixtures/README.md`, the launch-rule
 * catalog's own honest-review posture.
 *
 * Source: architecture/recommendations-and-ai.md, sections "4.
 * Structured Inputs", "8. Vertex AI Boundary", "9. Structured Output",
 * "13. Safety Tiers".
 */

import type { AiExplanationDraft } from '../../integrations/public.js';
import type { AiExplanationRejectionOutcome } from './ai-explanation.js';
import { findProhibitedCategory, scanActionConcepts } from './ai-explanation-lexicon.js';

/**
 * Hard bound on the served embellishment — section 8's "concise" made
 * checkable. Roughly twice the longest launch-rule baseline: room to
 * expand phrasing, none to append paragraphs of new content.
 */
export const MAX_EMBELLISHED_EXPLANATION_LENGTH = 700;

export interface AiExplanationValidationInput {
  readonly draft: AiExplanationDraft;
  /** The candidate's stored deterministic explanation — the baseline whose vocabulary bounds the draft. */
  readonly deterministicExplanation: string;
  /** The rule version's suggested action — part of the baseline's action vocabulary. */
  readonly actionTitle: string;
  /** The fact keys of the packet that was sent — the only evidence the draft may claim. */
  readonly packetFactKeys: readonly string[];
  /** The packet's fact values — the only source of numbers the draft may state. */
  readonly packetFactValues: readonly unknown[];
}

export type AiExplanationValidationVerdict =
  | { readonly verdict: 'accepted'; readonly text: string }
  | {
      readonly verdict: Exclude<
        AiExplanationRejectionOutcome,
        'schema_invalid' | 'provider_safety_blocked'
      >;
      /** A stable, content-free diagnostic (a concept/category id or a count) — safe for tests and never logged with user content. */
      readonly detail: string;
    };

const NUMBER_TOKEN_PATTERN = /\d+(?:[.,]\d+)?/gu;

/** Numeric tokens of `text`, normalized (decimal comma → point, parsed) so `0,5`, `0.5`, and `0.50` compare equal. */
function extractNumbers(text: string, into: Set<string>): void {
  for (const match of text.matchAll(NUMBER_TOKEN_PATTERN)) {
    into.add(String(Number.parseFloat(match[0].replace(',', '.'))));
  }
}

/** Every number stated anywhere inside a fact value — numbers directly, numeric tokens inside strings (ISO timestamps included), arrays and objects recursively. */
function collectNumbersDeep(value: unknown, into: Set<string>): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    into.add(String(value));
    return;
  }
  if (typeof value === 'string') {
    extractNumbers(value, into);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNumbersDeep(item, into);
    }
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      collectNumbersDeep(item, into);
    }
  }
}

export function validateAiExplanationDraft(
  input: AiExplanationValidationInput,
): AiExplanationValidationVerdict {
  const text = input.draft.explanation.trim();

  if (text.length > MAX_EMBELLISHED_EXPLANATION_LENGTH) {
    return { verdict: 'length_exceeded', detail: String(text.length) };
  }

  const knownKeys = new Set(input.packetFactKeys);
  if (input.draft.evidenceKeysUsed.length === 0) {
    return { verdict: 'unknown_evidence_reference', detail: 'no_evidence_referenced' };
  }
  for (const key of input.draft.evidenceKeysUsed) {
    if (!knownKeys.has(key)) {
      return { verdict: 'unknown_evidence_reference', detail: key };
    }
  }

  const prohibited = findProhibitedCategory(text);
  if (prohibited !== null) {
    return { verdict: 'prohibited_content', detail: prohibited };
  }

  const baseline = `${input.deterministicExplanation} ${input.actionTitle}`;
  const permittedConcepts = scanActionConcepts(baseline);
  for (const concept of scanActionConcepts(text)) {
    if (!permittedConcepts.has(concept)) {
      return { verdict: 'unsupported_action', detail: concept };
    }
  }

  const allowedNumbers = new Set<string>();
  extractNumbers(baseline, allowedNumbers);
  for (const value of input.packetFactValues) {
    collectNumbersDeep(value, allowedNumbers);
  }
  const draftNumbers = new Set<string>();
  extractNumbers(text, draftNumbers);
  for (const number of draftNumbers) {
    if (!allowedNumbers.has(number)) {
      return { verdict: 'unsupported_fact', detail: number };
    }
  }

  return { verdict: 'accepted', text };
}
