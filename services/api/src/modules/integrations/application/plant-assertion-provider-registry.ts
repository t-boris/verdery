/**
 * Registry for `PlantAssertionProviderAdapter` registrations — structurally
 * identical to `WeatherProviderRegistry`/`PlantContentProviderRegistry`
 * (construction-time validation, immutable after construction, `get`/`keys`)
 * but its own class, not a shared generic: the "tolerate-at-two, generalize-
 * at-the-third" judgment those two files' own headers already document
 * applies again here, at three. Metadata carries no `jurisdiction`/
 * `presentationNote` (unlike `PlantContentProviderMetadata`): structured
 * facts are cited data, not licensed prose with a presentation obligation to
 * declare — `licenseNote`/`attributionText` already cover what a stored
 * assertion's own citation needs.
 *
 * UNLIKE the weather and plant-content registries, MORE THAN ONE registered
 * provider can be active at once: ADR-0016 section 4 selects several
 * simultaneously-active free sources per knowledge class (not one "the"
 * provider), so there is no single `activeProviderKey` here — the caller
 * (`run-taxon-enrichment-sweep.ts`) is handed an ordered `sourcePriority`
 * list of keys to enrich against, the same policy-parameter shape
 * `assemblePlantProfileVersion`/`RebuildPlantProfileVersion` already use for
 * tie-breaking, applied here to WHICH providers a sweep calls at all.
 *
 * Source: architecture/decisions/ADR-0016-phase-11-plant-intelligence-domain-and-providers.md,
 * section 5; architecture/external-integrations.md, sections "3. Adapter
 * Contract", "4. Provider Registry".
 */

import { InternalError } from '../../../platform/errors/application-error.js';
import type { PlantAssertionProviderAdapter } from './plant-assertion-provider.js';
import type { ProviderQuotaLimits } from './provider-quota-repository.js';

export interface PlantAssertionProviderMetadata {
  /** Application-owned stable key — stamped onto every assertion this adapter produces and the quota-accounting key in `provider_quota_usage`. */
  readonly providerKey: string;
  readonly displayName: string;
  /** License and citation-form text, snapshotted onto every assertion's own provenance (`sourceCitation`, where the authoring method carries one). */
  readonly licenseNote: string;
  /** Attribution text a client must render, when the provider's terms require one; `null` when none is required. */
  readonly attributionText: string | null;
  readonly fetchTimeoutMs: number;
  readonly quotaLimits: ProviderQuotaLimits;
}

export interface PlantAssertionProviderRegistration {
  readonly metadata: PlantAssertionProviderMetadata;
  readonly adapter: PlantAssertionProviderAdapter;
}

function requireValidMetadata(metadata: PlantAssertionProviderMetadata): void {
  if (metadata.providerKey.trim().length === 0) {
    throw new InternalError(
      'integrations.plant_assertion_provider_registry.provider_key_blank',
      'A plant-assertion provider registration must carry a non-blank providerKey.',
    );
  }
  if (metadata.licenseNote.trim().length === 0) {
    throw new InternalError(
      'integrations.plant_assertion_provider_registry.license_note_blank',
      `Plant-assertion provider '${metadata.providerKey}' must declare its license note.`,
    );
  }
  if (!Number.isInteger(metadata.fetchTimeoutMs) || metadata.fetchTimeoutMs <= 0) {
    throw new InternalError(
      'integrations.plant_assertion_provider_registry.fetch_timeout_invalid',
      `Plant-assertion provider '${metadata.providerKey}' must declare a positive integer fetchTimeoutMs.`,
    );
  }
  for (const [window, limit] of Object.entries(metadata.quotaLimits)) {
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      throw new InternalError(
        'integrations.plant_assertion_provider_registry.quota_limit_invalid',
        `Plant-assertion provider '${metadata.providerKey}' has an invalid ${window}: a limit is null (unlimited) or a positive integer.`,
      );
    }
  }
}

export class PlantAssertionProviderRegistry {
  private readonly byKey: ReadonlyMap<string, PlantAssertionProviderRegistration>;

  constructor(registrations: readonly PlantAssertionProviderRegistration[]) {
    const byKey = new Map<string, PlantAssertionProviderRegistration>();
    for (const registration of registrations) {
      requireValidMetadata(registration.metadata);
      const key = registration.metadata.providerKey;
      if (byKey.has(key)) {
        throw new InternalError(
          'integrations.plant_assertion_provider_registry.duplicate_key',
          `Plant-assertion provider key '${key}' is registered twice.`,
        );
      }
      byKey.set(key, registration);
    }
    this.byKey = byKey;
  }

  /** The registration for `providerKey`, or `null` when no such provider is registered. */
  get(providerKey: string): PlantAssertionProviderRegistration | null {
    return this.byKey.get(providerKey) ?? null;
  }

  /** Registered keys, for configuration validation and provider-health reporting. */
  keys(): readonly string[] {
    return [...this.byKey.keys()];
  }
}
