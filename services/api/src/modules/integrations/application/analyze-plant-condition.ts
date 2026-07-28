/**
 * `AnalyzePlantCondition` — the bounded call machinery around the plant
 * condition analysis port, mirroring `identify-plant-species.ts`'s own
 * shape exactly. See `generate-ai-explanation.ts`'s header for the full
 * budget/failure-semantics reasoning this repeats structurally.
 *
 * `adapter` is `null` when the capability is disabled or unconfigured —
 * the default until `PLANT_CONDITION_AI_ENABLED` is flipped. The honest
 * runtime outcome is then `noProviderConfigured`, the exact shape
 * `image-analysis-result.ts`'s historical stub already answered with
 * regardless of cause.
 *
 * Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md.
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  PlantConditionAnalysisAdapterOutcome,
  PlantConditionAnalysisProviderAdapter,
  PlantConditionAnalysisRequest,
  PlantConditionObservation,
} from './plant-condition-analysis-provider.js';
import type { ProviderQuotaLimits, ProviderQuotaRepository } from './provider-quota-repository.js';
import { withDeadline } from './with-deadline.js';

export type PlantConditionAnalysisUnavailableReason =
  'noProviderConfigured' | 'quotaExhausted' | 'providerTimeout' | 'providerFailed';

export interface PlantConditionAnalysisProvenance {
  readonly providerKey: string;
  readonly model: string;
  readonly promptTemplateVersion: number;
}

export type AnalyzePlantConditionResult =
  | {
      readonly outcome: 'observation';
      readonly observation: PlantConditionObservation;
      readonly provenance: PlantConditionAnalysisProvenance;
    }
  | {
      readonly outcome: 'schemaInvalid';
      readonly rawText: string | null;
      readonly provenance: PlantConditionAnalysisProvenance;
    }
  | { readonly outcome: 'safetyBlocked'; readonly provenance: PlantConditionAnalysisProvenance }
  | { readonly outcome: 'unavailable'; readonly reason: PlantConditionAnalysisUnavailableReason };

export interface PlantConditionAnalysisCallPolicy {
  readonly providerKey: string;
  readonly callTimeoutMs: number;
  readonly quotaLimits: ProviderQuotaLimits;
}

export class AnalyzePlantCondition {
  constructor(
    private readonly adapter: PlantConditionAnalysisProviderAdapter | null,
    private readonly policy: PlantConditionAnalysisCallPolicy,
    private readonly providerQuotas: ProviderQuotaRepository,
    private readonly clock: Clock,
  ) {
    if (!Number.isInteger(policy.callTimeoutMs) || policy.callTimeoutMs <= 0) {
      throw new InternalError(
        'integrations.plant_condition_analysis.invalid_call_policy',
        'callTimeoutMs must be a positive integer of milliseconds.',
      );
    }
    if (policy.providerKey.trim().length === 0) {
      throw new InternalError(
        'integrations.plant_condition_analysis.invalid_call_policy',
        'providerKey must not be blank.',
      );
    }
  }

  async execute(request: PlantConditionAnalysisRequest): Promise<AnalyzePlantConditionResult> {
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
        adapter.analyzeCondition(request, signal),
      );
    } catch {
      return { outcome: 'unavailable', reason: 'providerFailed' };
    }
    if (call.kind === 'timedOut') {
      return { outcome: 'unavailable', reason: 'providerTimeout' };
    }

    const provenance: PlantConditionAnalysisProvenance = {
      providerKey: this.policy.providerKey,
      model: adapter.identity.model,
      promptTemplateVersion: adapter.identity.promptTemplateVersion,
    };
    return toResult(call.value, provenance);
  }
}

function toResult(
  outcome: PlantConditionAnalysisAdapterOutcome,
  provenance: PlantConditionAnalysisProvenance,
): AnalyzePlantConditionResult {
  switch (outcome.kind) {
    case 'observation':
      return { outcome: 'observation', observation: outcome.observation, provenance };
    case 'schemaInvalid':
      return { outcome: 'schemaInvalid', rawText: outcome.rawText, provenance };
    case 'safetyBlocked':
      return { outcome: 'safetyBlocked', provenance };
  }
}
