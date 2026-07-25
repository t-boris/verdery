/**
 * Plant-content provider registry — external-integrations.md section 4 made
 * typed for the second integration capability, the same way
 * `weather-provider-registry.ts` did for the first: registrations pair a
 * provider-neutral adapter with validated section 3 metadata, WHICH key is
 * active is environment configuration the consuming use cases receive
 * separately (null today — no plant-content provider has been selected,
 * P0-PROV-01), and replacing a provider is exactly one adapter class plus
 * one registration plus a configuration key change, without touching stored
 * records ("Provider selection changes through configuration plus
 * compatibility tests; it does not change domain records silently").
 *
 * Metadata grows section 8's two content-specific obligations on top of the
 * weather registry's set: the `jurisdiction` the provider's terms name and
 * the `presentationNote` describing the allowed presentation behavior —
 * both snapshotted onto every content record the registration produces.
 *
 * Deliberate parallel with `weather-provider-registry.ts`, not a premature
 * generic: two capabilities carry two registries with different metadata
 * shapes, the same tolerate-at-two/generalize-at-the-third judgment the
 * worker sweep machinery documented before `createIntervalSweepScheduler`
 * existed. The quota-limits shape IS shared (`ProviderQuotaLimits`, owned by
 * the quota port both capabilities consume).
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "4. Provider Registry", "8. Plant Content", "14. Cost and
 * Quota".
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import type { PlantContentProviderAdapter } from './plant-content-provider.js';
import type { ProviderQuotaLimits } from './provider-quota-repository.js';

/** Section 3's adapter contract plus section 8's content obligations, the parts this stage enforces mechanically. */
export interface PlantContentProviderMetadata {
  /** Application-owned stable key — stamped onto every mapping and record the adapter produces. */
  readonly providerKey: string;
  readonly displayName: string;
  /** License and redistribution constraints, snapshotted onto every record ("Provider content retains source and license metadata", section 16). */
  readonly licenseNote: string;
  /** Attribution text a client must render, when the provider's terms require one. */
  readonly attributionText: string | null;
  /** The jurisdiction the provider's terms name, where they name one (section 8) — null is "terms name none", never a guess. */
  readonly jurisdiction: string | null;
  /** The allowed presentation behavior the provider's terms grant (section 8) — always declared; a registration without one cannot exist. */
  readonly presentationNote: string;
  /** Strict per-call deadline in milliseconds (section 11: "Interactive provider calls use strict deadlines"). */
  readonly fetchTimeoutMs: number;
  /** Per-provider call budgets, enforced through the shared `ProviderQuotaRepository`. */
  readonly quotaLimits: ProviderQuotaLimits;
}

export interface PlantContentProviderRegistration {
  readonly metadata: PlantContentProviderMetadata;
  readonly adapter: PlantContentProviderAdapter;
}

function requireValidMetadata(metadata: PlantContentProviderMetadata): void {
  if (metadata.providerKey.trim().length === 0) {
    throw new InternalError(
      'integrations.plant_content_provider_registry.provider_key_blank',
      'A plant-content provider registration must carry a non-blank providerKey.',
    );
  }
  if (metadata.licenseNote.trim().length === 0) {
    throw new InternalError(
      'integrations.plant_content_provider_registry.license_note_blank',
      `Plant-content provider '${metadata.providerKey}' must declare its license note.`,
    );
  }
  if (metadata.presentationNote.trim().length === 0) {
    throw new InternalError(
      'integrations.plant_content_provider_registry.presentation_note_blank',
      `Plant-content provider '${metadata.providerKey}' must declare its allowed presentation behavior.`,
    );
  }
  if (!Number.isInteger(metadata.fetchTimeoutMs) || metadata.fetchTimeoutMs <= 0) {
    throw new InternalError(
      'integrations.plant_content_provider_registry.fetch_timeout_invalid',
      `Plant-content provider '${metadata.providerKey}' must declare a positive integer fetchTimeoutMs.`,
    );
  }
  for (const [window, limit] of Object.entries(metadata.quotaLimits)) {
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      throw new InternalError(
        'integrations.plant_content_provider_registry.quota_limit_invalid',
        `Plant-content provider '${metadata.providerKey}' has an invalid ${window}: a limit is null (unlimited) or a positive integer.`,
      );
    }
  }
}

/**
 * Immutable after construction: registrations are a composition-time fact,
 * not runtime-mutable state. All construction failures are `InternalError`:
 * a bad registration is a programming/configuration defect, never a
 * user-input problem — the `WeatherProviderRegistry` posture, verbatim.
 */
export class PlantContentProviderRegistry {
  private readonly byKey: ReadonlyMap<string, PlantContentProviderRegistration>;

  constructor(registrations: readonly PlantContentProviderRegistration[]) {
    const byKey = new Map<string, PlantContentProviderRegistration>();
    for (const registration of registrations) {
      requireValidMetadata(registration.metadata);
      const key = registration.metadata.providerKey;
      if (byKey.has(key)) {
        throw new InternalError(
          'integrations.plant_content_provider_registry.duplicate_key',
          `Plant-content provider key '${key}' is registered twice.`,
        );
      }
      byKey.set(key, registration);
    }
    this.byKey = byKey;
  }

  /** The registration for `providerKey`, or `null` when no such provider is registered. */
  get(providerKey: string): PlantContentProviderRegistration | null {
    return this.byKey.get(providerKey) ?? null;
  }

  /** Registered keys, for configuration validation and provider-health reporting. */
  keys(): readonly string[] {
    return [...this.byKey.keys()];
  }
}

/**
 * The registration for a configured active key, or a loud `InternalError`
 * when none exists: a configured-but-unregistered key is a composition
 * defect, never a runtime degradation. Shared by both plant-content use
 * cases — each fails at construction AND defensively at use, the
 * `RefreshGardenWeather` posture.
 */
export function requireRegisteredPlantContentProvider(
  registry: PlantContentProviderRegistry,
  activeProviderKey: string,
): PlantContentProviderRegistration {
  const registration = registry.get(activeProviderKey);
  if (registration === null) {
    throw new InternalError(
      'integrations.plant_content.active_provider_not_registered',
      `Active plant-content provider '${activeProviderKey}' has no registration.`,
    );
  }
  return registration;
}
