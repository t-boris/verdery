/**
 * Provider registry — external-integrations.md section 4 made typed:
 * "Configuration maps an integration capability to one active adapter per
 * environment", and section 3's per-adapter contract (timeout, quota,
 * license, attribution) lives HERE as per-provider metadata, so replacing a
 * provider is exactly one adapter class plus one registration plus a
 * configuration key change — "Provider selection changes through
 * configuration plus compatibility tests; it does not change domain records
 * silently" (existing `weather_record` rows keep their original
 * `provider_key` and license snapshot forever).
 *
 * The registry holds registrations; it does not choose. WHICH key is active
 * is configuration the consuming use case receives separately
 * (`activeProviderKey`, nullable — null is today's honest reality: no
 * weather provider has been selected, P0-PROV-01). Runtime multi-provider
 * routing is deliberately absent, per section 4's own "avoided initially".
 *
 * The NUMBERS in metadata (timeout, quota budgets) are configuration
 * injected at composition, not constants invented here — quotas and budgets
 * are undecided implementation-time selections (technical-specification.md
 * section 14.2).
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "4. Provider Registry", "14. Cost and Quota".
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import type { ProviderQuotaLimits } from './provider-quota-repository.js';
import type { WeatherProviderAdapter } from './weather-provider.js';

/** Section 3's adapter contract, the parts this stage enforces mechanically. */
export interface WeatherProviderMetadata {
  /** Application-owned stable key — stamped onto every record the adapter produces. */
  readonly providerKey: string;
  readonly displayName: string;
  /** License and redistribution constraints, snapshotted onto every record ("Provider content retains source and license metadata", section 16). */
  readonly licenseNote: string;
  /** Attribution text a client must render, when the provider's terms require one. */
  readonly attributionText: string | null;
  /** Strict per-call deadline in milliseconds (section 11: "Interactive provider calls use strict deadlines"). */
  readonly fetchTimeoutMs: number;
  /** Per-provider call budgets, enforced through the shared `ProviderQuotaRepository` (see its header for the shape's ownership). */
  readonly quotaLimits: ProviderQuotaLimits;
}

export interface WeatherProviderRegistration {
  readonly metadata: WeatherProviderMetadata;
  readonly adapter: WeatherProviderAdapter;
}

function requireValidMetadata(metadata: WeatherProviderMetadata): void {
  if (metadata.providerKey.trim().length === 0) {
    throw new InternalError(
      'integrations.weather_provider_registry.provider_key_blank',
      'A weather provider registration must carry a non-blank providerKey.',
    );
  }
  if (metadata.licenseNote.trim().length === 0) {
    throw new InternalError(
      'integrations.weather_provider_registry.license_note_blank',
      `Weather provider '${metadata.providerKey}' must declare its license note.`,
    );
  }
  if (!Number.isInteger(metadata.fetchTimeoutMs) || metadata.fetchTimeoutMs <= 0) {
    throw new InternalError(
      'integrations.weather_provider_registry.fetch_timeout_invalid',
      `Weather provider '${metadata.providerKey}' must declare a positive integer fetchTimeoutMs.`,
    );
  }
  for (const [window, limit] of Object.entries(metadata.quotaLimits)) {
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      throw new InternalError(
        'integrations.weather_provider_registry.quota_limit_invalid',
        `Weather provider '${metadata.providerKey}' has an invalid ${window}: a limit is null (unlimited) or a positive integer.`,
      );
    }
  }
}

/**
 * Immutable after construction: registrations are a composition-time fact,
 * not runtime-mutable state — the same "dependencies are explicit at
 * construction boundaries" rule the composition root follows
 * (backend-modular-monolith.md section 9). All construction failures are
 * `InternalError`: a bad registration is a programming/configuration
 * defect, never a user-input problem.
 */
export class WeatherProviderRegistry {
  private readonly byKey: ReadonlyMap<string, WeatherProviderRegistration>;

  constructor(registrations: readonly WeatherProviderRegistration[]) {
    const byKey = new Map<string, WeatherProviderRegistration>();
    for (const registration of registrations) {
      requireValidMetadata(registration.metadata);
      const key = registration.metadata.providerKey;
      if (byKey.has(key)) {
        throw new InternalError(
          'integrations.weather_provider_registry.duplicate_key',
          `Weather provider key '${key}' is registered twice.`,
        );
      }
      byKey.set(key, registration);
    }
    this.byKey = byKey;
  }

  /** The registration for `providerKey`, or `null` when no such provider is registered. */
  get(providerKey: string): WeatherProviderRegistration | null {
    return this.byKey.get(providerKey) ?? null;
  }

  /** Registered keys, for configuration validation and provider-health reporting. */
  keys(): readonly string[] {
    return [...this.byKey.keys()];
  }
}
