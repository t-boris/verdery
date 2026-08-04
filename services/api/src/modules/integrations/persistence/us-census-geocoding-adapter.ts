/**
 * The United States Census Bureau geocoder, behind this module's own
 * `AddressGeocodingAdapter` port.
 *
 * WHY THIS PROVIDER (owner decision, 2026-08-04). The product's first market
 * is the United States (ADR-0007), and this service is free, needs no API key
 * or account, and publishes public-domain data — so unlike every commercial
 * geocoder it raises no question about storing or deriving from a result, and
 * unlike Nominatim it carries neither ODbL share-alike nor a usage policy this
 * product would outgrow. Its limit is the same as its licence's source: US
 * addresses only. A garden outside the United States gets no candidates, and
 * the interface says so rather than pretending the search failed.
 *
 * Nothing from this provider is stored. The response is shown, the person
 * picks a candidate, and what persists is the georeference anchor they
 * accepted — see `address-geocoding-provider.ts`.
 *
 * HTTP follows `open-meteo-weather-adapter.ts` exactly: the platform's own
 * `fetch` (Node 24, ADR-0009), injected as a narrow structural slice so unit
 * tests answer with recorded payloads and no test touches the network.
 *
 * FAILURE POSTURE, per the port: a transport error, a non-2xx status, an
 * unreadable body, and a structurally malformed payload all reject with
 * `DependencyUnavailableError`. The caller degrades it; nothing crashes.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract" and "11. Reliability"; https://geocoding.geo.census.gov/geocoder/.
 */

import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  AddressGeocodingAdapter,
  GeocodedAddressCandidate,
} from '../application/address-geocoding-provider.js';
import { parseCensusGeocodingPayload } from './us-census-geocoding-payload.js';

export const US_CENSUS_GEOCODER_BASE_URL = 'https://geocoding.geo.census.gov';

/**
 * The address-range benchmark, pinned rather than left to the service's
 * default: `Public_AR_Current` is the current public address ranges, and a
 * default that moves under this adapter would change results with no change
 * here to explain it.
 */
const BENCHMARK = 'Public_AR_Current';

/** The response slice this adapter reads. A real `Response` is assignable — the same narrow slice `OpenMeteoHttpResponse` declares. */
export interface GeocodingHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls. `globalThis.fetch` is assignable as-is. */
export type GeocodingHttpFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<GeocodingHttpResponse>;

export interface UsCensusGeocodingAdapterOptions {
  readonly fetch: GeocodingHttpFetch;
  readonly baseUrl?: string;
}

export class UsCensusGeocodingAdapter implements AddressGeocodingAdapter {
  private readonly fetch: GeocodingHttpFetch;
  private readonly baseUrl: string;

  constructor(options: UsCensusGeocodingAdapterOptions) {
    this.fetch = options.fetch;
    this.baseUrl = options.baseUrl ?? US_CENSUS_GEOCODER_BASE_URL;
  }

  async findAddressCandidates(
    query: string,
    signal: AbortSignal,
  ): Promise<readonly GeocodedAddressCandidate[]> {
    const url = new URL('/geocoder/locations/onelineaddress', this.baseUrl);
    url.searchParams.set('address', query);
    url.searchParams.set('benchmark', BENCHMARK);
    url.searchParams.set('format', 'json');

    let response: GeocodingHttpResponse;

    try {
      response = await this.fetch(url.toString(), { signal });
    } catch (cause) {
      throw new DependencyUnavailableError(
        'integrations.us_census_geocoder.request_failed',
        'The address service could not be reached.',
        { cause },
      );
    }

    if (!response.ok) {
      throw new DependencyUnavailableError(
        'integrations.us_census_geocoder.http_status',
        `The address service answered with HTTP status ${String(response.status)}.`,
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch (cause) {
      throw new DependencyUnavailableError(
        'integrations.us_census_geocoder.unreadable_body',
        'The address service returned a body that could not be read.',
        { cause },
      );
    }

    try {
      return parseCensusGeocodingPayload(body);
    } catch (cause) {
      throw new DependencyUnavailableError(
        'integrations.us_census_geocoder.malformed_payload',
        'The address service returned an unexpected payload.',
        { cause },
      );
    }
  }
}
