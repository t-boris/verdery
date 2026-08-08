/**
 * Nominatim (OpenStreetMap), behind this module's own `AddressGeocodingAdapter`
 * port.
 *
 * WHY THIS PROVIDER, AND WHY IT REPLACES THE PREVIOUS ONE (owner decision,
 * 2026-08-08). The United States Census Bureau geocoder this replaces is a US
 * federal service, and US addresses are the only ones it has — a garden in
 * Europe got no candidates and the interface said so. That was correct while
 * the United States was the only market (ADR-0007) and became the reason a
 * European address could not be found at all.
 *
 * `us-census-geocoding-adapter.ts` argued against this provider in as many
 * words: "unlike Nominatim it carries neither ODbL share-alike nor a usage
 * policy this product would outgrow." That objection is answered rather than
 * ignored:
 *
 * - **Share-alike.** ODbL bites whoever redistributes or builds a derived
 *   database. This port stores NOTHING from the provider — the candidate is
 *   shown, the person picks one, and what persists is the anchor they
 *   accepted, which is their own confirmation and not a copy of anyone's
 *   database (see `address-geocoding-provider.ts`). Attribution is still owed
 *   wherever candidates are displayed, and is stated in the client.
 * - **The usage policy is real and is honoured here, not hoped about.** One
 *   request per second maximum, serialised below; an identifying `User-Agent`,
 *   without which the service refuses the request outright; and no bulk
 *   geocoding, which this product does not do — a person types one address
 *   when they create a garden.
 *
 * The policy is also why "outgrow" remains the right word. This adapter is
 * sized for a person searching for their own house. A product doing many
 * searches per second needs a paid provider or its own Nominatim instance, and
 * the port is the seam that makes that a one-file change.
 *
 * HTTP follows `open-meteo-weather-adapter.ts` and the adapter it replaces:
 * the platform's own `fetch` (Node 24, ADR-0009), injected as a narrow
 * structural slice so unit tests answer with recorded payloads and no test
 * touches the network.
 *
 * FAILURE POSTURE, per the port: transport error, non-2xx status, unreadable
 * body and structurally malformed payload all reject with
 * `DependencyUnavailableError`. The caller degrades it; nothing crashes.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract" and "11. Reliability";
 * https://operations.osmfoundation.org/policies/nominatim/ (usage policy);
 * https://nominatim.org/release-docs/latest/api/Search/.
 */

import { DependencyUnavailableError } from '../../../platform/errors/application-error.js';
import type {
  AddressGeocodingAdapter,
  GeocodedAddressCandidate,
} from '../application/address-geocoding-provider.js';
import { parseNominatimGeocodingPayload } from './nominatim-geocoding-payload.js';

export const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

/**
 * The minimum gap between requests, from the operator's published policy — an
 * absolute maximum of one per second.
 */
export const NOMINATIM_MINIMUM_REQUEST_INTERVAL_MS = 1000;

/** How many candidates to ask for. Enough to choose from, few enough to read. */
const RESULT_LIMIT = 5;

/**
 * The attribution owed wherever these candidates are shown. Exported so the
 * one string lives with the adapter that incurs it rather than being retyped
 * in each client.
 */
export const NOMINATIM_ATTRIBUTION = '© OpenStreetMap contributors';

/** The response slice this adapter reads. A real `Response` is assignable. */
export interface NominatimHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls. `globalThis.fetch` is assignable as-is. */
export type NominatimHttpFetch = (
  url: string,
  init: {
    readonly signal: AbortSignal;
    readonly headers: Readonly<Record<string, string>>;
  },
) => Promise<NominatimHttpResponse>;

export interface NominatimGeocodingAdapterOptions {
  readonly fetch: NominatimHttpFetch;
  /**
   * Identifies this application to the service. The policy requires it and
   * the service refuses requests without one, so it has no default: a build
   * that forgets it should fail here, at composition, and not in front of
   * somebody searching for their address.
   */
  readonly userAgent: string;
  readonly baseUrl?: string;
  /** Injected so a test can assert the pacing without waiting a second for it. */
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class NominatimGeocodingAdapter implements AddressGeocodingAdapter {
  private readonly fetch: NominatimHttpFetch;
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  /**
   * When the next request may go out, and the tail of the queue waiting for
   * it. One promise chain rather than a counter: two searches started in the
   * same tick must not both read "the last request was long ago" and leave
   * together, which is exactly how a rate limit is broken by accident.
   */
  private nextAllowedAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: NominatimGeocodingAdapterOptions) {
    if (options.userAgent.trim() === '') {
      throw new Error(
        'NominatimGeocodingAdapter requires a non-empty userAgent: the operator’s usage policy demands one and the service refuses requests without it.',
      );
    }

    this.fetch = options.fetch;
    this.userAgent = options.userAgent;
    this.baseUrl = options.baseUrl ?? NOMINATIM_BASE_URL;
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
  }

  async findAddressCandidates(
    query: string,
    signal: AbortSignal,
  ): Promise<readonly GeocodedAddressCandidate[]> {
    return this.paced(() => this.search(query, signal));
  }

  /**
   * Runs `work` no sooner than one interval after the previous one started,
   * serialising every caller through one chain.
   */
  private async paced<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.nextAllowedAt - this.now();
      if (wait > 0) {
        await this.sleep(wait);
      }
      this.nextAllowedAt = this.now() + NOMINATIM_MINIMUM_REQUEST_INTERVAL_MS;
      return work();
    });

    // The queue must advance even when this call fails, or one rejection
    // would wedge every search after it.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  private async search(
    query: string,
    signal: AbortSignal,
  ): Promise<readonly GeocodedAddressCandidate[]> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(RESULT_LIMIT));
    // Address detail is what makes a candidate recognisable as somebody's own
    // house rather than a point with a name.
    url.searchParams.set('addressdetails', '1');

    let response: NominatimHttpResponse;

    try {
      response = await this.fetch(url.toString(), {
        signal,
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      });
    } catch (cause) {
      throw new DependencyUnavailableError(
        'integrations.nominatim_geocoder.request_failed',
        'The address service could not be reached.',
        { cause },
      );
    }

    if (!response.ok) {
      throw new DependencyUnavailableError(
        'integrations.nominatim_geocoder.http_status',
        `The address service answered with HTTP status ${String(response.status)}.`,
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch (cause) {
      throw new DependencyUnavailableError(
        'integrations.nominatim_geocoder.unreadable_body',
        'The address service returned a body that could not be read.',
        { cause },
      );
    }

    const candidates = parseNominatimGeocodingPayload(body);

    if (candidates === null) {
      throw new DependencyUnavailableError(
        'integrations.nominatim_geocoder.malformed_payload',
        'The address service returned a response this application could not read.',
      );
    }

    return candidates;
  }
}
