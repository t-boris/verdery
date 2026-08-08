/**
 * Open-Meteo-backed `WeatherProviderAdapter` — the first REAL weather vendor
 * in this repository, closing the weather half of `P0-PROV-01` (the
 * plant-content half stays open).
 *
 * WHY OPEN-METEO: retention rights, not price. Every other evaluated
 * candidate forbids the thing this system structurally does — keep a
 * normalized, append-only `weather_record` row forever (Apple WeatherKit,
 * Tomorrow.io, Google Weather and WeatherAPI.com each ban persistent
 * storage, derived databases, or impose a deletion TTL; OpenWeather's ODbL
 * is share-alike). Open-Meteo's CC BY 4.0 permits durable storage and
 * redistribution with attribution, and the licence does NOT change on the
 * paid plan. The named fallback provider is NWS / api.weather.gov, which is
 * not built here; nothing in this adapter is in its way — a second adapter
 * class plus a second registration is the whole shape of adding it.
 *
 * TWO HOSTS, BOTH FROM CONFIGURATION (never hardcoded into a call):
 *
 * - `free` — `api.open-meteo.com`, no key, licensed NON-COMMERCIAL only.
 *   The keyless path development runs on, and the honest default.
 * - `customer` — `customer-api.open-meteo.com` with an `apikey` parameter,
 *   the paid Standard plan. There is no key yet; a `customer` tier without
 *   one is refused at construction rather than turned into a runtime storm
 *   of rejected requests.
 *
 * The licence stamped on stored rows differs between the two (the free tier
 * adds its non-commercial restriction), which is why
 * `open-meteo-weather-registration.ts` derives the licence note from the
 * SAME configuration this adapter is built from.
 *
 * HTTP: this service has no outbound HTTP client — the only other real
 * adapter (`vertex-ai-explanation-adapter.ts`) talks through a vendor SDK.
 * So this one calls the platform's own `fetch` (Node 24, ADR-0009), injected
 * as the narrow structural `OpenMeteoHttpFetch` slice for the same reason
 * the Vertex adapter takes `VertexGenerativeClient`: unit tests answer with
 * recorded payloads and no test ever touches the network. `globalThis.fetch`
 * is assignable as-is. No new dependency.
 *
 * FAILURE POSTURE, per the port: "May reject with anything; the caller
 * converts every failure into a typed degradation, never a crash." A
 * transport error, a non-2xx status, an unreadable body, and a structurally
 * malformed payload all reject with `DependencyUnavailableError`, which
 * `refresh-garden-weather.ts` degrades to `providerFailed`. The caller's
 * `AbortSignal` is passed straight into the request, so its strict deadline
 * really cancels the call.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "4. Provider Registry", "5. Weather", "11. Reliability".
 */

import {
  DependencyUnavailableError,
  InternalError,
} from '../../../platform/errors/application-error.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  NormalizedWeatherReading,
  WeatherProviderAdapter,
} from '../application/weather-provider.js';
import type { WeatherLocation } from '../domain/weather-record.js';
import {
  OPEN_METEO_CURRENT_VARIABLES,
  OPEN_METEO_DAILY_VARIABLES,
  OPEN_METEO_HOURLY_VARIABLES,
  OPEN_METEO_PINNED_MODELS,
  parseOpenMeteoPayload,
} from './open-meteo-payload.js';

/** The keyless, non-commercial host. */
export const OPEN_METEO_FREE_BASE_URL = 'https://api.open-meteo.com';
/** The paid Standard-plan host; every call carries the `apikey` parameter. */
export const OPEN_METEO_CUSTOMER_BASE_URL = 'https://customer-api.open-meteo.com';

export const OPEN_METEO_FORECAST_PATH = '/v1/forecast';

/** Which host answers. Both are real, licensed differently; configuration chooses. */
export type OpenMeteoTier = 'free' | 'customer';

export interface OpenMeteoWeatherAdapterConfiguration {
  readonly tier: OpenMeteoTier;
  /** `null` on the keyless free tier; required on `customer`. Treated as a secret and never logged. */
  readonly apiKey: string | null;
  /** How much recent past model output to request — the watering rules' recent-rainfall input. */
  readonly pastDays: number;
  readonly forecastDays: number;
}

/** The response slice this adapter reads. A real `Response` is assignable. */
export interface OpenMeteoHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** The `fetch` slice this adapter calls. `globalThis.fetch` is assignable as-is. */
export type OpenMeteoHttpFetch = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<OpenMeteoHttpResponse>;

function baseUrlFor(tier: OpenMeteoTier): string {
  return tier === 'customer' ? OPEN_METEO_CUSTOMER_BASE_URL : OPEN_METEO_FREE_BASE_URL;
}

/**
 * Builds the exact request URL. Exported for the adapter's own
 * request-shaping tests (the `buildGenerateContentParameters` precedent) —
 * the pinned `models=` list in particular is what makes the licence stamped
 * on every stored row deterministic rather than a guess about routing.
 */
export function buildOpenMeteoRequestUrl(
  location: WeatherLocation,
  configuration: OpenMeteoWeatherAdapterConfiguration,
): string {
  const url = new URL(OPEN_METEO_FORECAST_PATH, baseUrlFor(configuration.tier));
  const parameters = url.searchParams;
  parameters.set('latitude', String(location.latitude));
  parameters.set('longitude', String(location.longitude));
  parameters.set('models', OPEN_METEO_PINNED_MODELS.join(','));
  parameters.set('current', OPEN_METEO_CURRENT_VARIABLES.join(','));
  parameters.set('daily', OPEN_METEO_DAILY_VARIABLES.join(','));
  // The forecast half. The daily block carries rain and nothing else, so a
  // forecast built from it could only ever report rain — see
  // `OPEN_METEO_HOURLY_VARIABLES`. Same call, same quota.
  parameters.set('hourly', OPEN_METEO_HOURLY_VARIABLES.join(','));
  parameters.set('past_days', String(configuration.pastDays));
  parameters.set('forecast_days', String(configuration.forecastDays));
  // Explicit SI, explicitly requested — `open-meteo-payload.ts` then accepts
  // a value only when the response echoes the SI label that was asked for.
  parameters.set('temperature_unit', 'celsius');
  parameters.set('wind_speed_unit', 'ms');
  parameters.set('precipitation_unit', 'mm');
  // Timestamps without a local offset, read as UTC by the payload parser.
  parameters.set('timezone', 'UTC');
  if (configuration.apiKey !== null) {
    parameters.set('apikey', configuration.apiKey);
  }
  return url.toString();
}

/**
 * Validates configuration the way a composition defect should be caught:
 * at construction, as an `InternalError`, before any garden is served a
 * degradation for a reason nobody configured.
 */
export function validateOpenMeteoConfiguration(
  configuration: OpenMeteoWeatherAdapterConfiguration,
): void {
  const invalid = (message: string): InternalError =>
    new InternalError('integrations.open_meteo.invalid_configuration', message);

  if (configuration.tier === 'customer' && configuration.apiKey === null) {
    throw invalid('The paid customer-api.open-meteo.com tier requires an API key.');
  }
  if (configuration.apiKey !== null && configuration.apiKey.trim().length === 0) {
    throw invalid('apiKey must not be blank when present.');
  }
  if (!Number.isInteger(configuration.pastDays) || configuration.pastDays < 0) {
    throw invalid('pastDays must be a non-negative integer.');
  }
  if (!Number.isInteger(configuration.forecastDays) || configuration.forecastDays <= 0) {
    throw invalid('forecastDays must be a positive integer.');
  }
}

export class OpenMeteoWeatherAdapter implements WeatherProviderAdapter {
  constructor(
    private readonly httpFetch: OpenMeteoHttpFetch,
    private readonly configuration: OpenMeteoWeatherAdapterConfiguration,
    private readonly clock: Clock,
  ) {
    validateOpenMeteoConfiguration(configuration);
  }

  async fetchWeather(
    location: WeatherLocation,
    signal: AbortSignal,
  ): Promise<readonly NormalizedWeatherReading[]> {
    const url = buildOpenMeteoRequestUrl(location, this.configuration);

    let response: OpenMeteoHttpResponse;
    try {
      response = await this.httpFetch(url, { signal });
    } catch (error) {
      // Includes the caller's own abort: the deadline already decided the
      // outcome, and this rejection is what tells it the call really stopped.
      throw new DependencyUnavailableError(
        'integrations.open_meteo.request_failed',
        'The Open-Meteo request did not complete.',
        { cause: error },
      );
    }

    if (!response.ok) {
      // The status alone — never the URL, which carries the API key.
      throw new DependencyUnavailableError(
        'integrations.open_meteo.http_status',
        `Open-Meteo answered with HTTP status ${String(response.status)}.`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new DependencyUnavailableError(
        'integrations.open_meteo.unreadable_body',
        'The Open-Meteo response body was not readable JSON.',
        { cause: error },
      );
    }

    return parseOpenMeteoPayload(body, this.clock.now());
  }
}
