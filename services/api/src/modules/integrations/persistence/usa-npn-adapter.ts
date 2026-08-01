/**
 * USA-NPN-backed `PlantAssertionProviderAdapter` — the fourth real adapter
 * for the structured fact/distribution port, and ADR-0016's "phenology"
 * source.
 *
 * NO SERVER-SIDE NAME SEARCH: `docs/development/plant-knowledge-provider-
 * runbooks.md` section 3.2 and `usa-npn-payload.ts`'s own header both
 * record that the species-catalog endpoint takes no query parameters at
 * all. `searchTaxa` therefore fetches the WHOLE catalog (1,940 entries,
 * verified live) and matches client-side: an exact, case-insensitive
 * binomial match against `${genus} ${species}` — never a fuzzy/partial
 * match, the same "never invented" posture every other adapter's search
 * takes when a provider supplies no scored matching of its own (WFO's
 * `confidence: null`, USDA's `confidence: null`). A query the catalog does
 * not contain returns an empty array, read as "nothing listed".
 *
 * DATE WINDOW FOR fetchFacts: the port's `fetchFacts(providerTaxonId,
 * signal)` carries no date range, but USA-NPN's summarized-data endpoint
 * requires one. This adapter queries the most recently COMPLETED calendar
 * year as of the injected `Clock` — never the current, still-in-progress
 * year, which would understate a phenophase's full season. The clock
 * parameter is why this adapter (unlike `UsdaPlantsAdapter`, which stamps
 * no timestamp of its own) needs one, the same reason
 * `OpenMeteoWeatherAdapter` takes one.
 *
 * `request_src`: the API spec marks this required for the summary endpoint
 * even though a live test without it still returned data (the runbook's own
 * finding) — set anyway, since it costs nothing and the spec calls it
 * required.
 *
 * NO KEY FOR READS (OAuth exists only for writing observations, not used
 * here). HTTP: `globalThis.fetch`, GET-only.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "11. Reliability"; docs/development/plant-knowledge-provider-
 * runbooks.md, section 3.2.
 */

import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  NormalizedDistributionCandidate,
  NormalizedFactCandidate,
  PlantAssertionProviderAdapter,
  ProviderTaxonCandidate,
  TaxonomyIdentityQuery,
} from '../application/plant-assertion-provider.js';
import {
  parseUsaNpnSpeciesCatalogPayload,
  parseUsaNpnSummarizedDataPayload,
} from './usa-npn-payload.js';

export const USA_NPN_BASE_URL = 'https://services.usanpn.org';
const SPECIES_PATH = '/npn_portal/species/getSpecies.json';
const SUMMARIZED_DATA_PATH = '/npn_portal/observations/getSummarizedData.json';

/** This application's own client identifier — the `request_src` the summary endpoint's spec marks required. */
const REQUEST_SOURCE = 'verdery';

/** The response slice this adapter reads. A real `Response` is assignable. */
export interface UsaNpnHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls — GET only. `globalThis.fetch` is assignable as-is. */
export type UsaNpnHttpFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<UsaNpnHttpResponse>;

async function getJson(
  httpFetch: UsaNpnHttpFetch,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  let response: UsaNpnHttpResponse;
  try {
    response = await httpFetch(url, { signal });
  } catch (error) {
    throw new DependencyUnavailableError(
      'integrations.usa_npn.request_failed',
      'A USA-NPN request did not complete.',
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new DependencyUnavailableError(
      'integrations.usa_npn.http_status',
      `USA-NPN answered with HTTP status ${String(response.status)}.`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new DependencyUnavailableError(
      'integrations.usa_npn.unreadable_body',
      'A USA-NPN response body was not readable JSON.',
      { cause: error },
    );
  }
}

/** The most recently completed calendar year as of `now` — exported for this adapter's own request-shaping tests. */
export function lastCompletedCalendarYear(now: Date): number {
  return now.getUTCFullYear() - 1;
}

export class UsaNpnAdapter implements PlantAssertionProviderAdapter {
  constructor(
    private readonly httpFetch: UsaNpnHttpFetch,
    private readonly clock: Clock,
  ) {}

  async searchTaxa(
    query: TaxonomyIdentityQuery,
    signal: AbortSignal,
  ): Promise<readonly ProviderTaxonCandidate[]> {
    const url = new URL(SPECIES_PATH, USA_NPN_BASE_URL).toString();
    const body = await getJson(this.httpFetch, url, signal);
    const catalog = parseUsaNpnSpeciesCatalogPayload(body);

    const normalizedQuery = query.scientificName.trim().toLowerCase();
    return catalog
      .filter((entry) => `${entry.genus} ${entry.species}`.toLowerCase() === normalizedQuery)
      .map((entry) => ({
        providerTaxonId: String(entry.speciesId),
        scientificName: `${entry.genus} ${entry.species}`,
        confidence: null,
      }));
  }

  async fetchFacts(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedFactCandidate[]> {
    const year = lastCompletedCalendarYear(this.clock.now());
    const url = new URL(SUMMARIZED_DATA_PATH, USA_NPN_BASE_URL);
    url.searchParams.set('start_date', `${String(year)}-01-01`);
    url.searchParams.set('end_date', `${String(year)}-12-31`);
    url.searchParams.set('species_id', providerTaxonId);
    url.searchParams.set('request_src', REQUEST_SOURCE);
    const body = await getJson(this.httpFetch, url.toString(), signal);
    return parseUsaNpnSummarizedDataPayload(body);
  }

  /** Always empty — USA-NPN carries phenology data only, no distribution/status claims. */
  fetchDistribution(
    _providerTaxonId: string,
    _signal: AbortSignal,
  ): Promise<readonly NormalizedDistributionCandidate[]> {
    return Promise.resolve([]);
  }
}
