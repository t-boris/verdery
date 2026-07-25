/**
 * Provider-neutral weather port — the boundary external-integrations.md
 * section 2 draws: "domain/application → provider-neutral port → provider
 * adapter → external API. Provider SDK and payload types remain inside the
 * adapter." Everything an adapter returns is already normalized to this
 * module's own shapes; no vendor payload type crosses this line.
 *
 * No real adapter implements this port yet: weather provider selection is
 * P0-PROV-01, an undecided implementation-time selection. The port exists
 * so that when a vendor IS selected, its adapter is one new class plus one
 * registry entry (`weather-provider-registry.ts`) — proven by this stage's
 * own replacement tests, which run two different fakes through the
 * identical machinery. Until then the deterministic fakes in
 * `integrations-test-doubles.ts` are the only implementations, and the
 * honest runtime state is "no provider configured"
 * (`refresh-garden-weather.ts`).
 *
 * Source: architecture/external-integrations.md, sections "2. Integration
 * Boundary", "3. Adapter Contract", "15. Testing" ("Provider replacement
 * compatibility").
 */

import type {
  WeatherLocation,
  WeatherMeasurements,
  WeatherProviderQuality,
  WeatherRecordKind,
  WeatherSourceUnits,
} from '../domain/weather-record.js';

/**
 * One normalized reading as the adapter reports it: what the reading is
 * about (`kind` + `effectiveAt`), the SI-normalized measurements, and the
 * provenance/quality the provider supplied. The garden, fetch time,
 * provider key, and license metadata are deliberately NOT here — those are
 * the CALLER's facts (which garden asked, when, through which registry
 * entry), stamped by `refresh-garden-weather.ts` when it turns readings
 * into persisted `WeatherRecord`s.
 */
export interface NormalizedWeatherReading {
  readonly kind: WeatherRecordKind;
  readonly effectiveAt: Date;
  readonly measurements: WeatherMeasurements;
  readonly sourceUnits: WeatherSourceUnits;
  readonly quality: WeatherProviderQuality;
}

export interface WeatherProviderAdapter {
  /**
   * Fetches current readings (an observation and/or forecast entries) for
   * one location. `signal` aborts when the caller's bounded deadline
   * (section 11's "Interactive provider calls use strict deadlines")
   * expires — a real HTTP adapter must pass it through to its request; the
   * caller enforces the deadline either way. May reject with anything; the
   * caller converts every failure into a typed degradation, never a crash.
   */
  fetchWeather(
    location: WeatherLocation,
    signal: AbortSignal,
  ): Promise<readonly NormalizedWeatherReading[]>;
}
