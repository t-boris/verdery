/**
 * `IdentifyPlantSpecies` — the bounded call machinery around the plant
 * species identification port, mirroring `generate-ai-explanation.ts`'s
 * own shape exactly (budget consumed before the call, strict per-call
 * deadline, a typed outcome for every way the call can fail to produce a
 * candidate). See that file's header for the full budget/failure-
 * semantics reasoning, restated here only where it differs.
 *
 * `adapter` is `null` when the capability is disabled or unconfigured —
 * the default on every environment until `PLANT_IDENTIFICATION_AI_ENABLED`
 * is flipped, which itself requires the manual spot-check and provider-
 * terms verification ADR-0015 names. The honest runtime outcome is then
 * `noProviderConfigured` — the exact shape `identify-plant-from-photo.ts`
 * already needs, since its historical stub answered every call with "no
 * suggestion" regardless of cause.
 *
 * Source: architecture/decisions/ADR-0015-phase10-redirect-plants-over-photo-capture.md.
 */

import type { FastifyBaseLogger } from 'fastify';
import { InternalError } from '../../../platform/errors/application-error.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  PlantSpeciesCandidate,
  PlantSpeciesIdentificationAdapterOutcome,
  PlantSpeciesIdentificationProviderAdapter,
  PlantSpeciesIdentificationRequest,
} from './plant-species-identification-provider.js';
import { VISION_ANALYSIS_SOURCE_MAX_BYTES } from '@verdery/api-contracts';
import type { ProviderQuotaLimits, ProviderQuotaRepository } from './provider-quota-repository.js';
import { withDeadline } from './with-deadline.js';

export type PlantSpeciesIdentificationUnavailableReason =
  | 'noProviderConfigured'
  | 'quotaExhausted'
  | 'providerTimeout'
  | 'providerFailed'
  /**
   * The photograph is larger than the provider accepts. Refused before the
   * call rather than after: the answer is knowable from the file's own size,
   * and a request that cannot succeed should not be paid for. Distinct from
   * `providerFailed`, because this one has a remedy a person can act on.
   */
  | 'photoTooLarge';

export interface PlantSpeciesIdentificationProvenance {
  readonly providerKey: string;
  readonly model: string;
  readonly promptTemplateVersion: number;
}

export type IdentifyPlantSpeciesResult =
  | {
      readonly outcome: 'candidate';
      readonly candidate: PlantSpeciesCandidate;
      readonly provenance: PlantSpeciesIdentificationProvenance;
    }
  | {
      readonly outcome: 'noConfidentCandidate';
      readonly provenance: PlantSpeciesIdentificationProvenance;
    }
  | {
      readonly outcome: 'schemaInvalid';
      readonly rawText: string | null;
      readonly provenance: PlantSpeciesIdentificationProvenance;
    }
  | { readonly outcome: 'safetyBlocked'; readonly provenance: PlantSpeciesIdentificationProvenance }
  | {
      readonly outcome: 'unavailable';
      readonly reason: PlantSpeciesIdentificationUnavailableReason;
    };

export interface PlantSpeciesIdentificationCallPolicy {
  readonly providerKey: string;
  readonly callTimeoutMs: number;
  readonly quotaLimits: ProviderQuotaLimits;
}

export class IdentifyPlantSpecies {
  constructor(
    private readonly adapter: PlantSpeciesIdentificationProviderAdapter | null,
    private readonly policy: PlantSpeciesIdentificationCallPolicy,
    private readonly providerQuotas: ProviderQuotaRepository,
    private readonly clock: Clock,
    private readonly logger: FastifyBaseLogger,
  ) {
    if (!Number.isInteger(policy.callTimeoutMs) || policy.callTimeoutMs <= 0) {
      throw new InternalError(
        'integrations.plant_species_identification.invalid_call_policy',
        'callTimeoutMs must be a positive integer of milliseconds.',
      );
    }
    if (policy.providerKey.trim().length === 0) {
      throw new InternalError(
        'integrations.plant_species_identification.invalid_call_policy',
        'providerKey must not be blank.',
      );
    }
  }

  async execute(request: PlantSpeciesIdentificationRequest): Promise<IdentifyPlantSpeciesResult> {
    if (this.adapter === null) {
      return { outcome: 'unavailable', reason: 'noProviderConfigured' };
    }
    const adapter = this.adapter;

    // Before the quota, because a call that cannot succeed should not consume
    // one — and before the provider, because the answer is already knowable
    // from the file's own size. A 30.79 MiB photograph produced a bare
    // `400 INVALID_ARGUMENT` here on 2026-08-04, logged as a provider
    // failure, and reached the person as a plant with no species and no
    // reason.
    if (request.photo.byteSize > VISION_ANALYSIS_SOURCE_MAX_BYTES) {
      return { outcome: 'unavailable', reason: 'photoTooLarge' };
    }

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
        adapter.identifySpecies(request, signal),
      );
    } catch (error) {
      this.logger.warn(
        { event: 'plant_species_ai.provider_failed', providerKey: this.policy.providerKey, error },
        'Plant species identification provider call threw.',
      );
      return { outcome: 'unavailable', reason: 'providerFailed' };
    }
    if (call.kind === 'timedOut') {
      this.logger.warn(
        { event: 'plant_species_ai.provider_timeout', providerKey: this.policy.providerKey },
        'Plant species identification provider call timed out.',
      );
      return { outcome: 'unavailable', reason: 'providerTimeout' };
    }

    const provenance: PlantSpeciesIdentificationProvenance = {
      providerKey: this.policy.providerKey,
      model: adapter.identity.model,
      promptTemplateVersion: adapter.identity.promptTemplateVersion,
    };
    const result = toResult(call.value, provenance);
    this.logger.info(
      {
        event: 'plant_species_ai.result',
        outcome: result.outcome,
        model: adapter.identity.model,
        // Truncated: this is the model's own plant-description text, not
        // user PII or a credential, but a runaway response should not blow
        // up a log line either.
        rawText:
          result.outcome === 'schemaInvalid' ? (result.rawText?.slice(0, 2000) ?? null) : undefined,
        commonName: result.outcome === 'candidate' ? result.candidate.commonName : undefined,
        confidenceScore:
          result.outcome === 'candidate' ? result.candidate.confidenceScore : undefined,
      },
      'Plant species identification call resolved.',
    );
    return result;
  }
}

function toResult(
  outcome: PlantSpeciesIdentificationAdapterOutcome,
  provenance: PlantSpeciesIdentificationProvenance,
): IdentifyPlantSpeciesResult {
  switch (outcome.kind) {
    case 'candidate':
      return { outcome: 'candidate', candidate: outcome.candidate, provenance };
    case 'noConfidentCandidate':
      return { outcome: 'noConfidentCandidate', provenance };
    case 'schemaInvalid':
      return { outcome: 'schemaInvalid', rawText: outcome.rawText, provenance };
    case 'safetyBlocked':
      return { outcome: 'safetyBlocked', provenance };
  }
}
