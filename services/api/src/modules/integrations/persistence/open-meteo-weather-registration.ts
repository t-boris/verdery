/**
 * The Open-Meteo registry entry — section 3's per-adapter contract
 * (license, attribution, timeout, quota) as the `WeatherProviderMetadata`
 * the registry validates and `refresh-garden-weather.ts` snapshots onto
 * every row it writes.
 *
 * WHY THE LICENCE LIVES HERE AND NOT IN THE ADAPTER'S OUTPUT: a
 * `NormalizedWeatherReading` deliberately carries no licence or attribution
 * ("those are the CALLER's facts", `weather-provider.ts`). The caller reads
 * them from the registration, so this file is where the provider's terms
 * become the persisted `licenseNote` / `attributionText` — snapshotted per
 * row, so a later terms change cannot silently rewrite the licence of data
 * already stored.
 *
 * THE TERMS, verified live 2026-07-26:
 *
 * - CC BY 4.0, and the paid plan does NOT change it. Every persisted record
 *   carries that licence.
 * - Attribution is a UI obligation: "You must include a link next to any
 *   location Open-Meteo data are displayed." The domain models attribution
 *   as ONE free-text field (`WeatherRecord.attributionText`) and has no
 *   attribution-URL field of its own, so the required link travels inside
 *   that text — clients render the text and the link it names. Adding a
 *   structured `attributionUrl` would be a domain/migration change this
 *   stage does not own; the gap is recorded in
 *   `docs/architecture/external-integrations.md` section 5.
 * - The free host is non-commercial-only, so its licence note says so. The
 *   note is derived from the same tier configuration the adapter uses, never
 *   written by hand per environment.
 *
 * Source: architecture/external-integrations.md, sections "3. Adapter
 * Contract", "4. Provider Registry", "5. Weather", "16. Completion
 * Criteria".
 */

import type { Clock } from '../../../shared/time/clock.js';
import type { ProviderQuotaLimits } from '../application/provider-quota-repository.js';
import type { WeatherProviderRegistration } from '../application/weather-provider-registry.js';
import { OPEN_METEO_PINNED_MODELS } from './open-meteo-payload.js';
import type {
  OpenMeteoHttpFetch,
  OpenMeteoWeatherAdapterConfiguration,
} from './open-meteo-weather-adapter.js';
import { OpenMeteoWeatherAdapter } from './open-meteo-weather-adapter.js';

/**
 * The application-owned registry key — stamped as `provider_key` on every
 * row this adapter produces, and the quota-accounting key in
 * `provider_quota_usage`. Never an Open-Meteo identifier.
 */
export const OPEN_METEO_PROVIDER_KEY = 'open-meteo';

export const OPEN_METEO_DISPLAY_NAME = 'Open-Meteo';

/** The link the terms require next to any displayed data. */
export const OPEN_METEO_ATTRIBUTION_URL = 'https://open-meteo.com';

/**
 * The attribution a client MUST render, link included — the domain has one
 * text field for it, so the URL is part of the text.
 */
export const OPEN_METEO_ATTRIBUTION_TEXT = `Weather data by Open-Meteo.com (${OPEN_METEO_ATTRIBUTION_URL}), CC BY 4.0`;

const LICENSE_BASE =
  'Open-Meteo weather data, licensed CC BY 4.0 ' +
  '(https://creativecommons.org/licenses/by/4.0/). Redistribution and durable storage are ' +
  'permitted with attribution, and a link to https://open-meteo.com must appear next to any ' +
  'display of this data. Model sources are pinned to NOAA ' +
  `(${OPEN_METEO_PINNED_MODELS.join(', ')}), so no share-alike source (for example UK Met ` +
  'Office data, CC-BY-SA) can have contributed to this record.';

const FREE_TIER_RESTRICTION =
  ' Retrieved from the keyless api.open-meteo.com tier, which permits non-commercial use only.';

const CUSTOMER_TIER_NOTE =
  ' Retrieved from the paid customer-api.open-meteo.com tier (Standard plan), which permits ' +
  'commercial use; the CC BY 4.0 licence is unchanged by the paid plan.';

/** The licence snapshot for one tier — the free host carries a restriction the paid host does not. */
export function openMeteoLicenseNote(tier: OpenMeteoWeatherAdapterConfiguration['tier']): string {
  return LICENSE_BASE + (tier === 'customer' ? CUSTOMER_TIER_NOTE : FREE_TIER_RESTRICTION);
}

export interface OpenMeteoRegistrationOptions {
  readonly configuration: OpenMeteoWeatherAdapterConfiguration;
  /** Strict per-call deadline (section 11) — configuration, never a constant invented here. */
  readonly fetchTimeoutMs: number;
  /** Per-provider call budgets (section 14) — configuration, same reason. */
  readonly quotaLimits: ProviderQuotaLimits;
}

/**
 * The one registration a composition root adds to `WeatherProviderRegistry`.
 * Everything provider-specific — key, licence, attribution, adapter — is
 * built here; the composition root supplies only configuration, the HTTP
 * function, and the clock.
 */
export function createOpenMeteoWeatherRegistration(
  options: OpenMeteoRegistrationOptions,
  httpFetch: OpenMeteoHttpFetch,
  clock: Clock,
): WeatherProviderRegistration {
  return {
    metadata: {
      providerKey: OPEN_METEO_PROVIDER_KEY,
      displayName: OPEN_METEO_DISPLAY_NAME,
      licenseNote: openMeteoLicenseNote(options.configuration.tier),
      attributionText: OPEN_METEO_ATTRIBUTION_TEXT,
      fetchTimeoutMs: options.fetchTimeoutMs,
      quotaLimits: options.quotaLimits,
    },
    adapter: new OpenMeteoWeatherAdapter(httpFetch, options.configuration, clock),
  };
}
