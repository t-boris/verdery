/**
 * The USDA PLANTS registry entry — section 3's per-adapter contract
 * (license, attribution, timeout, quota) as the `PlantAssertionProviderMetadata`
 * the registry validates and `refresh-taxon-assertions.ts` snapshots onto
 * every assertion it writes as `sourceCitation`.
 *
 * THE TERMS, per `docs/development/plant-knowledge-provider-runbooks.md`
 * section 2.2 (verified live 2026-07-31): public domain (17 U.S.C. §105,
 * confirmed against usda.gov's own policy page), no license restriction, no
 * attribution LEGALLY required. USDA nonetheless publishes a recommended
 * citation form on the PLANTS Help page, which this registration snapshots
 * as `licenseNote` so every stored assertion's provenance can render it —
 * `attributionText` stays `null` (the weather/plant-content registries'
 * own convention: `null` means the provider's terms do not REQUIRE one,
 * not that no citation text exists).
 */

import type { ProviderQuotaLimits } from '../application/provider-quota-repository.js';
import type { PlantAssertionProviderRegistration } from '../application/plant-assertion-provider-registry.js';
import type { UsdaPlantsHttpFetch } from './usda-plants-adapter.js';
import { UsdaPlantsAdapter } from './usda-plants-adapter.js';

/** Application-owned stable key — stamped as `provider_key` on every mapping/assertion this adapter produces. */
export const USDA_PLANTS_PROVIDER_KEY = 'usda-plants';

export const USDA_PLANTS_DISPLAY_NAME = 'USDA PLANTS Database';

/** The USDA-recommended citation form, from the PLANTS Help page. */
export const USDA_PLANTS_CITATION =
  'Natural Resources Conservation Service. PLANTS Database. United States Department of ' +
  'Agriculture. https://plants.usda.gov.';

const LICENSE_NOTE =
  'Public domain (17 U.S.C. §105) — U.S. federal government work, no restriction on reuse or ' +
  `redistribution. No attribution is legally required; the recommended citation is: ${USDA_PLANTS_CITATION} ` +
  'Individually-credited photography elsewhere on the PLANTS site may be separately copyrighted; ' +
  'this adapter never fetches imagery, only taxonomic/status/characteristics data.';

export interface UsdaPlantsRegistrationOptions {
  /** Strict per-call deadline (section 11) — configuration, never a constant invented here. Deliberately generous by default: no documented rate limit exists for this undocumented internal API. */
  readonly fetchTimeoutMs: number;
  /** Per-provider call budgets (section 14) — configuration, same reason. Deliberately conservative by default, for the same "can change or disappear without notice" reason. */
  readonly quotaLimits: ProviderQuotaLimits;
}

/**
 * The one registration a composition root adds to
 * `PlantAssertionProviderRegistry`. Everything provider-specific — key,
 * licence, adapter — is built here; the composition root supplies only
 * configuration and the HTTP function. Unlike `createOpenMeteoWeatherRegistration`,
 * no clock parameter: this adapter stamps no timestamp of its own — fetch
 * time is the caller's fact (`refresh-taxon-assertions.ts`), the same
 * separation `plant-assertion-provider.ts`'s own header documents.
 */
export function createUsdaPlantsRegistration(
  options: UsdaPlantsRegistrationOptions,
  httpFetch: UsdaPlantsHttpFetch,
): PlantAssertionProviderRegistration {
  return {
    metadata: {
      providerKey: USDA_PLANTS_PROVIDER_KEY,
      displayName: USDA_PLANTS_DISPLAY_NAME,
      licenseNote: LICENSE_NOTE,
      attributionText: null,
      fetchTimeoutMs: options.fetchTimeoutMs,
      quotaLimits: options.quotaLimits,
    },
    adapter: new UsdaPlantsAdapter(httpFetch),
  };
}
