/**
 * Provider-neutral AI-explanation port — the third capability of the
 * integrations module (backend-modular-monolith.md 6.9 "provider
 * adapters"), behind the same boundary the weather and plant-content
 * ports draw: "domain/application → provider-neutral port → provider
 * adapter → external API. Provider SDK and payload types remain inside
 * the adapter" (external-integrations.md section 2).
 *
 * The one approved use case this port carries is recommendations-and-
 * ai.md section 8's "Converting evidence into concise natural-language
 * explanation": the adapter receives a minimal evidence packet (the
 * candidate's rule identity, its ALREADY-RENDERED deterministic
 * explanation, its evidence facts, and a target locale) and returns a
 * schema-parsed draft — or a typed refusal. The adapter owns transport
 * and the use-case output schema (external-integrations.md section 9:
 * "The adapter enforces use-case schema, model configuration, privacy
 * filtering, timeout, cost budget, and structured-result validation");
 * the SEMANTIC validation of a draft against the candidate's own
 * evidence/action vocabulary is deliberately not here — it belongs to
 * tasks-recommendations, the module that owns explanations
 * (`domain/ai-explanation-validation.ts`).
 *
 * Unlike weather and plant-content there is NO provider registry: the
 * platform commitment to Vertex AI is an accepted architectural decision
 * (ADR-0008 — "A different provider can replace Vertex AI behind the
 * adapter without changing domain semantics"), not an undecided
 * P0-PROV-01 vendor evaluation, so one port with one real adapter
 * (`persistence/vertex-ai-explanation-adapter.ts`) is the honest shape;
 * a registry of alternative AI vendors would be dead machinery.
 *
 * Source: architecture/recommendations-and-ai.md, sections "8. Vertex AI
 * Boundary" and "9. Structured Output"; architecture/external-
 * integrations.md, sections "2. Integration Boundary" and "9. AI
 * Providers"; ADR-0008.
 */

/** The two product languages — section 16's "Russian and English quality evaluation" names exactly these. */
export type AiExplanationLocale = 'en' | 'ru';

/**
 * One evidence fact from the candidate's own stored evidence rows —
 * "The model receives a minimal evidence packet containing stable fact
 * identifiers" (section 10). Only these facts may be referenced by the
 * generated text; nothing else about the garden is sent (section 15's
 * "Send only required facts to Vertex AI").
 */
export interface AiExplanationEvidenceFact {
  readonly factKey: string;
  readonly factValue: unknown;
}

export interface AiExplanationRequest {
  readonly ruleKey: string;
  readonly ruleVersion: number;
  /** The rule's suggested action — part of the baseline's action vocabulary the embellishment may restate but never extend. */
  readonly actionTitle: string;
  /** The stored deterministic explanation — the baseline the model may rephrase or expand, and the guaranteed fallback when it fails to. */
  readonly deterministicExplanation: string;
  readonly locale: AiExplanationLocale;
  readonly evidenceFacts: readonly AiExplanationEvidenceFact[];
}

/** The model's schema-parsed output: the embellished text plus its own claim of which evidence facts it used (validated downstream against the packet). */
export interface AiExplanationDraft {
  readonly explanation: string;
  readonly evidenceKeysUsed: readonly string[];
}

/**
 * What the adapter reports about itself — section 10's "Prompt-template
 * version. Model and configuration version.", stamped on every stored
 * AI-explanation record so evaluation can replay and audit by version
 * (section 18's "Model-version replay and audit").
 */
export interface AiExplanationModelIdentity {
  readonly model: string;
  readonly promptTemplateVersion: number;
}

/**
 * One call's outcome, already normalized. `schemaInvalid` carries the raw
 * model text (bounded by the adapter's own token budget) because the
 * evaluation record stores generated text alongside its validation
 * outcome (section 10); `safetyBlocked` is the provider's OWN safety
 * filter refusing — section 17's "Safety-filter outcome", observable as
 * its own stored verdict. Transport failures are NOT outcomes: the
 * adapter rejects, and `generate-ai-explanation.ts` converts every
 * rejection/timeout into a typed degradation.
 */
export type AiExplanationAdapterOutcome =
  | { readonly kind: 'draft'; readonly draft: AiExplanationDraft }
  | { readonly kind: 'schemaInvalid'; readonly rawText: string | null }
  | { readonly kind: 'safetyBlocked' };

export interface AiExplanationProviderAdapter {
  readonly identity: AiExplanationModelIdentity;

  /**
   * Generates one bounded explanation draft. `signal` aborts when the
   * caller's deadline expires (the `WeatherProviderAdapter.fetchWeather`
   * contract); a real adapter must pass it through to its request. May
   * reject with anything; the caller converts every failure into a typed
   * degradation, never a crash.
   */
  generateExplanation(
    request: AiExplanationRequest,
    signal: AbortSignal,
  ): Promise<AiExplanationAdapterOutcome>;
}
