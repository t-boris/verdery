/**
 * `GenerateAiExplanation` — the bounded call machinery around the AI
 * explanation port: budget consumed strictly BEFORE the call, strict
 * per-call deadline, and a typed outcome for every way the call can fail
 * to produce a draft. Exported cross-module for tasks-recommendations'
 * embellishment use case, the `GetGardenWeather` use-case-injection
 * precedent.
 *
 * The budget is the shared `provider_quota_usage` accounting the weather
 * and plant-content capabilities already consume (Stage 22 made
 * `ProviderQuotaLimits` capability-neutral for exactly this kind of
 * arrival): one `consumeCall` per provider call, consumed before the call
 * so concurrent runs cannot collectively overshoot, a consumed-then-
 * timed-out call staying consumed because the call was made. With
 * `maxOutputTokens` bounded by the adapter, calls-per-window IS the spend
 * budget — cost per call is capped by construction, so capping calls caps
 * spend (external-integrations.md section 14).
 *
 * Failure semantics follow recommendations-and-ai.md section 14 ("Calls
 * retry only for safe transient outcomes"): `noProviderConfigured`,
 * `quotaExhausted`, `providerTimeout`, and `providerFailed` are TRANSIENT
 * degradations — the caller records nothing durable and a later run may
 * try again under a fresh budget. `schemaInvalid` and `safetyBlocked` are
 * the model's own answer for this packet — durable verdicts the caller
 * records so evaluation can count them (section 17's schema-validation
 * failure and safety-filter outcomes), never retried.
 *
 * `adapter` is `null` when the AI explanation capability is disabled or
 * unconfigured — today's reality on every environment (the kill-switch,
 * `RECOMMENDATION_AI_EXPLANATION_ENABLED`, defaults to false and no
 * Vertex access is enabled on verdery-dev). The honest runtime outcome is
 * then the typed `noProviderConfigured`, the `RefreshGardenWeather`
 * posture exactly.
 *
 * Source: architecture/recommendations-and-ai.md, sections "8. Vertex AI
 * Boundary" and "14. Provider Failure"; architecture/external-
 * integrations.md, sections "11. Reliability" and "14. Cost and Quota".
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  AiExplanationAdapterOutcome,
  AiExplanationDraft,
  AiExplanationProviderAdapter,
  AiExplanationRequest,
} from './ai-explanation-provider.js';
import type { ProviderQuotaLimits, ProviderQuotaRepository } from './provider-quota-repository.js';
import { withDeadline } from './with-deadline.js';

/** Why no draft was produced this call. Every value is a documented transient degradation the consumer may branch on — see this file's header. */
export type AiExplanationUnavailableReason =
  'noProviderConfigured' | 'quotaExhausted' | 'providerTimeout' | 'providerFailed';

/**
 * The provenance stamped on every stored AI-explanation record:
 * `providerKey` is the composition root's name for the active adapter
 * (also its quota-accounting key); `model` and `promptTemplateVersion`
 * are the adapter's own identity.
 */
export interface AiExplanationProvenance {
  readonly providerKey: string;
  readonly model: string;
  readonly promptTemplateVersion: number;
}

export type GenerateAiExplanationResult =
  | {
      readonly outcome: 'draft';
      readonly draft: AiExplanationDraft;
      readonly provenance: AiExplanationProvenance;
    }
  | {
      readonly outcome: 'schemaInvalid';
      readonly rawText: string | null;
      readonly provenance: AiExplanationProvenance;
    }
  | { readonly outcome: 'safetyBlocked'; readonly provenance: AiExplanationProvenance }
  | { readonly outcome: 'unavailable'; readonly reason: AiExplanationUnavailableReason };

/** The call policy the composition root derives from validated configuration — timeout and budget are section 8's own adapter-defined bounds. */
export interface AiExplanationCallPolicy {
  /** The active adapter's stable name — the quota-accounting key and the stored record's provider provenance. */
  readonly providerKey: string;
  readonly callTimeoutMs: number;
  readonly quotaLimits: ProviderQuotaLimits;
}

export class GenerateAiExplanation {
  constructor(
    private readonly adapter: AiExplanationProviderAdapter | null,
    private readonly policy: AiExplanationCallPolicy,
    private readonly providerQuotas: ProviderQuotaRepository,
    private readonly clock: Clock,
  ) {
    if (!Number.isInteger(policy.callTimeoutMs) || policy.callTimeoutMs <= 0) {
      // A malformed policy is a composition defect, not a runtime
      // degradation — the `RefreshGardenWeather` construction posture.
      throw new InternalError(
        'integrations.ai_explanation.invalid_call_policy',
        'callTimeoutMs must be a positive integer of milliseconds.',
      );
    }
    if (policy.providerKey.trim().length === 0) {
      throw new InternalError(
        'integrations.ai_explanation.invalid_call_policy',
        'providerKey must not be blank.',
      );
    }
  }

  async execute(request: AiExplanationRequest): Promise<GenerateAiExplanationResult> {
    if (this.adapter === null) {
      return { outcome: 'unavailable', reason: 'noProviderConfigured' };
    }
    const adapter = this.adapter;

    const quota = await this.providerQuotas.consumeCall(
      this.policy.providerKey,
      this.policy.quotaLimits,
      this.clock.now(),
    );
    if (!quota.consumed) {
      return { outcome: 'unavailable', reason: 'quotaExhausted' };
    }

    let call;
    try {
      call = await withDeadline(this.policy.callTimeoutMs, (signal) =>
        adapter.generateExplanation(request, signal),
      );
    } catch {
      return { outcome: 'unavailable', reason: 'providerFailed' };
    }
    if (call.kind === 'timedOut') {
      return { outcome: 'unavailable', reason: 'providerTimeout' };
    }

    const provenance: AiExplanationProvenance = {
      providerKey: this.policy.providerKey,
      model: adapter.identity.model,
      promptTemplateVersion: adapter.identity.promptTemplateVersion,
    };
    return toResult(call.value, provenance);
  }
}

function toResult(
  outcome: AiExplanationAdapterOutcome,
  provenance: AiExplanationProvenance,
): GenerateAiExplanationResult {
  switch (outcome.kind) {
    case 'draft':
      return { outcome: 'draft', draft: outcome.draft, provenance };
    case 'schemaInvalid':
      return { outcome: 'schemaInvalid', rawText: outcome.rawText, provenance };
    case 'safetyBlocked':
      return { outcome: 'safetyBlocked', provenance };
  }
}
