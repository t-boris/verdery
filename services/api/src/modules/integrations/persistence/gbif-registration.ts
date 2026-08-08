/**
 * The GBIF registry entry — the `PlantAssertionProviderMetadata` the
 * registry validates and `refresh-taxon-assertions.ts` snapshots onto every
 * fact assertion it writes as `sourceCitation`.
 *
 * THE TERMS, per `docs/development/plant-knowledge-provider-runbooks.md`
 * section 3.1: no key for reads, no published hard rate limit. GBIF's own
 * per-occurrence-record `license` field is mixed CC0/CC-BY/CC-BY-NC and is
 * NOT read by this adapter at all — `gbif-adapter.ts` only ever queries
 * aggregate occurrence-count facets, never individual records, so no
 * per-record license attaches to anything this registration's facts carry.
 * What DOES apply, at the aggregate-query level, is GBIF's own standing
 * data-use request to cite "GBIF.org" as the access point — `attributionText`
 * is non-null for that reason, distinct from (and simpler than) the
 * per-download DOI citation GBIF's Downloads API would require for a bulk
 * pull this adapter never makes.
 */

import type { ProviderQuotaLimits } from '../application/provider-quota-repository.js';
import type { PlantAssertionProviderRegistration } from '../application/plant-assertion-provider-registry.js';
import type { GbifHttpFetch } from './gbif-adapter.js';
import { GbifAdapter } from './gbif-adapter.js';

/** Application-owned stable key — stamped as `provider_key` on every assertion this adapter produces. */
export const GBIF_PROVIDER_KEY = 'gbif';

export const GBIF_DISPLAY_NAME = 'GBIF (Global Biodiversity Information Facility)';

/** GBIF's own standing citation request for API-accessed (non-download) data. */
export const GBIF_CITATION =
  'GBIF.org. Free and open access to biodiversity data. https://www.gbif.org.';

const LICENSE_NOTE =
  'No key or published rate limit for reads (docs/development/plant-knowledge-provider-runbooks.md ' +
  'section 3.1). This adapter reads only aggregate occurrence-count facets, never individual ' +
  "occurrence records — GBIF's own per-record license field (mixed CC0/CC-BY/CC-BY-NC) never " +
  `applies to anything stored here. Recommended citation: ${GBIF_CITATION} Occurrence counts are ` +
  'evidence of documented sightings, never a native/introduced/invasive/regulated status claim ' +
  '(ADR-0016 section 4).';

export interface GbifRegistrationOptions {
  /** Strict per-call deadline (section 11) — configuration, never a constant invented here. */
  readonly fetchTimeoutMs: number;
  /** Per-provider call budgets (section 14) — configuration, same reason. */
  readonly quotaLimits: ProviderQuotaLimits;
}

/**
 * The one registration a composition root adds to
 * `PlantAssertionProviderRegistry`. No clock parameter, the same
 * `createUsdaPlantsRegistration` reasoning: this adapter stamps no
 * timestamp of its own.
 */
export function createGbifRegistration(
  options: GbifRegistrationOptions,
  httpFetch: GbifHttpFetch,
): PlantAssertionProviderRegistration {
  return {
    metadata: {
      providerKey: GBIF_PROVIDER_KEY,
      displayName: GBIF_DISPLAY_NAME,
      licenseNote: LICENSE_NOTE,
      citationText: GBIF_CITATION,
      attributionText: GBIF_CITATION,
      fetchTimeoutMs: options.fetchTimeoutMs,
      quotaLimits: options.quotaLimits,
    },
    adapter: new GbifAdapter(httpFetch),
  };
}
