/**
 * USDA PLANTS-backed `PlantAssertionProviderAdapter` — the first REAL
 * adapter for the structured fact/distribution port (`plant-assertion-
 * provider.ts`), closing part of the P11-ASYNC-01 gap ADR-0016 section 5
 * names ("build real, ship kill-switched"). Covers TWO of ADR-0013's
 * separately-named sources in one adapter — "USDA PLANTS (US names/
 * status)" and "USDA PLANTS Characteristics (care attributes)" — because
 * both are, in reality, different endpoints of the SAME undocumented
 * internal API host; see `usda-plants-payload.ts`'s own header for the
 * live-verified endpoint shapes.
 *
 * NO API KEY, NO DOCUMENTED RATE LIMIT: `docs/development/plant-knowledge-
 * provider-runbooks.md` section 2.2 flags this explicitly — "this looks
 * like an internal API the frontend calls, not a published integration
 * point... treat this as a source that can change or disappear without
 * notice." The generous default timeout/quota this adapter's registration
 * carries (see `usda-plants-registration.ts`) is deliberate defensive
 * posture for exactly that risk, not a guess.
 *
 * HTTP: `globalThis.fetch`, the same "no HTTP client dependency" posture
 * `open-meteo-weather-adapter.ts`'s own header documents, injected as a
 * narrow structural `UsdaPlantsHttpFetch` slice (unlike Open-Meteo's
 * GET-only slice, this one also needs `method`/`headers`/`body` for the
 * search endpoint's POST). `globalThis.fetch` is assignable as-is.
 *
 * FAILURE POSTURE, per the port: every failure — transport, non-2xx status,
 * unreadable body, malformed structure — becomes a `DependencyUnavailableError`,
 * which `refresh-taxon-assertions.ts` degrades to a typed outcome, never a
 * crash. `fetchDistribution` fans out to three endpoints
 * (`PlantProfile`/`PlantNoxiousStatus`/`PlantInvasiveStatus`) under the ONE
 * caller-supplied deadline; a failure on any one fails the whole call rather
 * than silently returning a partial result the caller cannot distinguish
 * from "nothing listed".
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "11. Reliability"; docs/development/plant-knowledge-provider-
 * runbooks.md, section 2.2.
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
  parseUsdaPlantsCharacteristicsPayload,
  parseUsdaPlantsInvasiveStatuses,
  parseUsdaPlantsNoxiousStatuses,
  parseUsdaPlantsProfileNativeStatuses,
  parseUsdaPlantsSearchPayload,
} from './usda-plants-payload.js';

export const USDA_PLANTS_BASE_URL = 'https://plantsservices.sc.egov.usda.gov';
const SEARCH_PATH = '/api/plants-search-results';
const PROFILE_PATH = '/api/PlantProfile';
const CHARACTERISTICS_PATH = '/api/PlantCharacteristics';
const NOXIOUS_STATUS_PATH = '/api/PlantNoxiousStatus';
const INVASIVE_STATUS_PATH = '/api/PlantInvasiveStatus';

/** The response slice this adapter reads. A real `Response` is assignable. */
export interface UsdaPlantsHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls — GET and POST both, unlike Open-Meteo's GET-only slice. `globalThis.fetch` is assignable as-is. */
export type UsdaPlantsHttpFetch = (
  url: string,
  init: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal: AbortSignal;
  },
) => Promise<UsdaPlantsHttpResponse>;

async function getJson(
  httpFetch: UsdaPlantsHttpFetch,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  let response: UsdaPlantsHttpResponse;
  try {
    response = await httpFetch(url, { signal });
  } catch (error) {
    throw new DependencyUnavailableError(
      'integrations.usda_plants.request_failed',
      'A USDA PLANTS request did not complete.',
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new DependencyUnavailableError(
      'integrations.usda_plants.http_status',
      `USDA PLANTS answered with HTTP status ${String(response.status)}.`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new DependencyUnavailableError(
      'integrations.usda_plants.unreadable_body',
      'A USDA PLANTS response body was not readable JSON.',
      { cause: error },
    );
  }
}

export class UsdaPlantsAdapter implements PlantAssertionProviderAdapter {
  constructor(private readonly httpFetch: UsdaPlantsHttpFetch) {}

  async searchTaxa(
    query: TaxonomyIdentityQuery,
    signal: AbortSignal,
  ): Promise<readonly ProviderTaxonCandidate[]> {
    const url = new URL(SEARCH_PATH, USDA_PLANTS_BASE_URL).toString();
    let response: UsdaPlantsHttpResponse;
    try {
      response = await this.httpFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          Text: query.scientificName,
          Field: 'Scientific Name',
          Type: 'Basic',
          pageNumber: 1,
        }),
        signal,
      });
    } catch (error) {
      throw new DependencyUnavailableError(
        'integrations.usda_plants.request_failed',
        'The USDA PLANTS search request did not complete.',
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new DependencyUnavailableError(
        'integrations.usda_plants.http_status',
        `USDA PLANTS search answered with HTTP status ${String(response.status)}.`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new DependencyUnavailableError(
        'integrations.usda_plants.unreadable_body',
        'The USDA PLANTS search response body was not readable JSON.',
        { cause: error },
      );
    }
    return parseUsdaPlantsSearchPayload(body);
  }

  async fetchFacts(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedFactCandidate[]> {
    const url = new URL(
      `${CHARACTERISTICS_PATH}/${providerTaxonId}`,
      USDA_PLANTS_BASE_URL,
    ).toString();
    const body = await getJson(this.httpFetch, url, signal);
    return parseUsdaPlantsCharacteristicsPayload(body);
  }

  async fetchDistribution(
    providerTaxonId: string,
    signal: AbortSignal,
  ): Promise<readonly NormalizedDistributionCandidate[]> {
    const profileUrl = new URL(
      `${PROFILE_PATH}/${providerTaxonId}`,
      USDA_PLANTS_BASE_URL,
    ).toString();
    const noxiousUrl = new URL(
      `${NOXIOUS_STATUS_PATH}/${providerTaxonId}`,
      USDA_PLANTS_BASE_URL,
    ).toString();
    const invasiveUrl = new URL(
      `${INVASIVE_STATUS_PATH}/${providerTaxonId}`,
      USDA_PLANTS_BASE_URL,
    ).toString();

    const [profileBody, noxiousBody, invasiveBody] = await Promise.all([
      getJson(this.httpFetch, profileUrl, signal),
      getJson(this.httpFetch, noxiousUrl, signal),
      getJson(this.httpFetch, invasiveUrl, signal),
    ]);

    return [
      ...parseUsdaPlantsProfileNativeStatuses(profileBody),
      ...parseUsdaPlantsNoxiousStatuses(noxiousBody),
      ...parseUsdaPlantsInvasiveStatuses(invasiveBody),
    ];
  }

  /** Always empty — USDA PLANTS' image library is not exposed by the API this adapter reads. */
  fetchMedia(
    _providerTaxonId: string,
    _signal: AbortSignal,
  ): Promise<readonly NormalizedMediaCandidate[]> {
    return Promise.resolve([]);
  }
}
