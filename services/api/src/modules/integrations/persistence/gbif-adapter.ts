/**
 * GBIF-backed `PlantAssertionProviderAdapter` — the third real adapter for
 * the structured fact/distribution port, and ADR-0016's "occurrence
 * evidence" source. Reports documented sightings as facts
 * (`occurrence_evidence_count`, nationwide and per state/province); never
 * reports a distribution/status claim, per ADR-0016 section 4's explicit
 * "never used to infer garden suitability directly" — `fetchDistribution`
 * always answers an empty array, structurally, rather than trusting a
 * caller to ignore a native/introduced guess this adapter has no basis to
 * make (occurrence presence alone does not distinguish a native population
 * from an escaped ornamental).
 *
 * NO KEY FOR READS, NO PUBLISHED HARD RATE LIMIT (`docs/development/plant-
 * knowledge-provider-runbooks.md` section 3.1) — GBIF's own guidance
 * recommends the separate Downloads API only for bulk pulls expected to run
 * more than ~15 minutes, not relevant to this adapter's single-taxon calls.
 *
 * HTTP: `globalThis.fetch`, GET-only — the `open-meteo-weather-adapter.ts`
 * GET-only slice shape. `globalThis.fetch` is assignable as-is.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "11. Reliability"; docs/development/plant-knowledge-provider-
 * runbooks.md, section 3.1; ADR-0016, section 4.
 */

import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  NormalizedDistributionCandidate,
  NormalizedMediaCandidate,
  NormalizedFactCandidate,
  PlantAssertionProviderAdapter,
  ProviderTaxonCandidate,
  TaxonomyIdentityQuery,
} from '../application/plant-assertion-provider.js';
import {
  parseGbifOccurrenceFacetPayload,
  parseGbifOccurrenceMediaPayload,
  parseGbifSpeciesMatchPayload,
} from './gbif-payload.js';

export const GBIF_BASE_URL = 'https://api.gbif.org';
const SPECIES_MATCH_PATH = '/v1/species/match';
const OCCURRENCE_SEARCH_PATH = '/v1/occurrence/search';

/** How many top states/provinces to request per fetchFacts call — comfortably above the ~56 US states/territories GBIF's own vocabulary distinguishes. */
const STATE_PROVINCE_FACET_LIMIT = 60;

/**
 * Occurrence records read per media fetch.
 *
 * A profile shows a handful of reference images, and each record can carry
 * several; twenty is generous for that and small enough that one taxon's
 * enrichment cannot pull thousands of records from a shared public API. The
 * usable subset is smaller still, since a mixed result set is exactly what
 * the licence rule filters.
 */
const MEDIA_RECORD_LIMIT = 20;

/** The response slice this adapter reads. A real `Response` is assignable. */
export interface GbifHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls — GET only. `globalThis.fetch` is assignable as-is. */
export type GbifHttpFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<GbifHttpResponse>;

async function getJson(
  httpFetch: GbifHttpFetch,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  let response: GbifHttpResponse;
  try {
    response = await httpFetch(url, { signal });
  } catch (error) {
    throw new DependencyUnavailableError(
      'integrations.gbif.request_failed',
      'A GBIF request did not complete.',
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new DependencyUnavailableError(
      'integrations.gbif.http_status',
      `GBIF answered with HTTP status ${String(response.status)}.`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new DependencyUnavailableError(
      'integrations.gbif.unreadable_body',
      'A GBIF response body was not readable JSON.',
      { cause: error },
    );
  }
}

export class GbifAdapter implements PlantAssertionProviderAdapter {
  constructor(private readonly httpFetch: GbifHttpFetch) {}

  async searchTaxa(
    query: TaxonomyIdentityQuery,
    signal: AbortSignal,
  ): Promise<readonly ProviderTaxonCandidate[]> {
    const url = new URL(SPECIES_MATCH_PATH, GBIF_BASE_URL);
    url.searchParams.set('name', query.scientificName);
    const body = await getJson(this.httpFetch, url.toString(), signal);
    return parseGbifSpeciesMatchPayload(body);
  }

  async fetchFacts(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedFactCandidate[]> {
    const url = new URL(OCCURRENCE_SEARCH_PATH, GBIF_BASE_URL);
    url.searchParams.set('taxonKey', providerTaxonId);
    url.searchParams.set('country', 'US');
    url.searchParams.set('facet', 'stateProvince');
    url.searchParams.set('facetLimit', String(STATE_PROVINCE_FACET_LIMIT));
    // No individual records are read, only the aggregate facet counts — see
    // `gbif-payload.ts`'s own header on why no per-record `license` field
    // ever needs to be read here.
    url.searchParams.set('limit', '0');
    const body = await getJson(this.httpFetch, url.toString(), signal);
    return parseGbifOccurrenceFacetPayload(body);
  }

  async fetchMedia(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedMediaCandidate[]> {
    const url = new URL(OCCURRENCE_SEARCH_PATH, GBIF_BASE_URL);
    url.searchParams.set('taxonKey', providerTaxonId);
    // Unlike `fetchFacts`, this DOES read individual records — so every
    // media entry's own `license` is read per entry, exactly as this file's
    // payload header requires of any pass that stops using facet counts.
    url.searchParams.set('mediaType', 'StillImage');
    url.searchParams.set('limit', String(MEDIA_RECORD_LIMIT));
    const body = await getJson(this.httpFetch, url.toString(), signal);
    return parseGbifOccurrenceMediaPayload(body);
  }

  /** Always empty — see this file's own header on ADR-0016's "never used to infer garden suitability directly". */
  fetchDistribution(
    _providerTaxonId: string,
    _signal: AbortSignal,
  ): Promise<readonly NormalizedDistributionCandidate[]> {
    return Promise.resolve([]);
  }
}
