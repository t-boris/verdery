/**
 * Public interface of the integrations module — backend-modular-monolith.md
 * section 6.9's module ("provider adapters, normalized external
 * observations, quota policy, licensing metadata"), first materialized by
 * P7-INT-01 with its weather half.
 *
 * Other modules and the composition root may import only from this file.
 * Two audiences, named per this codebase's convention even when one is
 * still empty:
 *
 * - Other modules: none yet. P7-RULE-01's rule engine is the intended first
 *   consumer (`GetGardenWeather` and its typed freshness/absence outcomes
 *   are built for it); P7-ASYNC-01's scheduler is the intended caller of
 *   `RefreshGardenWeather`. Neither exists yet.
 * - The composition root: nothing is wired into `app.ts` this stage,
 *   deliberately — no HTTP route exposes weather (the OpenAPI contract has
 *   no `Weather` tag), no scheduler calls the refresh yet, and wiring
 *   dependencies no caller reaches would be dead composition. The concrete
 *   classes are exported so the stage that first needs them (P7-ASYNC-01 or
 *   P7-RULE-01) wires them without touching this module, mirroring
 *   P7-DATA-01's own "no app.ts change until a stage has a command to wire"
 *   posture.
 *
 * No real weather provider exists (P0-PROV-01 undecided): the registry has
 * zero production registrations, `activeProviderKey` is null in every
 * environment, and the honest runtime outcome is the typed
 * `noProviderConfigured` degradation — see
 * `application/refresh-garden-weather.ts`.
 *
 * Source: architecture/backend-modular-monolith.md, sections "5.5 Public
 * Interface" and "6.9 Integrations".
 */

export { WEATHER_UNIT_SYSTEM, createWeatherRecord } from './domain/weather-record.js';
export type {
  CreateWeatherRecordInput,
  WeatherLocation,
  WeatherMeasurements,
  WeatherProviderQuality,
  WeatherRecord,
  WeatherRecordKind,
  WeatherSourceUnits,
} from './domain/weather-record.js';
export {
  classifyWeatherFreshness,
  validateWeatherFreshnessPolicy,
} from './domain/weather-freshness.js';
export type { WeatherFreshness, WeatherFreshnessPolicy } from './domain/weather-freshness.js';

export type {
  NormalizedWeatherReading,
  WeatherProviderAdapter,
} from './application/weather-provider.js';
export { WeatherProviderRegistry } from './application/weather-provider-registry.js';
export type {
  WeatherProviderMetadata,
  WeatherProviderQuotaLimits,
  WeatherProviderRegistration,
} from './application/weather-provider-registry.js';
export type { WeatherRecordRepository } from './application/weather-record-repository.js';
export { quotaWindowStart } from './application/provider-quota-repository.js';
export type {
  ProviderQuotaConsumeResult,
  ProviderQuotaRepository,
  ProviderQuotaWindowKind,
} from './application/provider-quota-repository.js';

export { RefreshGardenWeather } from './application/refresh-garden-weather.js';
export type {
  RefreshGardenWeatherConfiguration,
  RefreshGardenWeatherInput,
  RefreshGardenWeatherResult,
  WeatherUnavailableReason,
} from './application/refresh-garden-weather.js';
export { GetGardenWeather } from './application/get-garden-weather.js';
export type {
  GetGardenWeatherInput,
  GetGardenWeatherResult,
} from './application/get-garden-weather.js';

export { KyselyWeatherRecordRepository } from './persistence/kysely-weather-record-repository.js';
export { KyselyProviderQuotaRepository } from './persistence/kysely-provider-quota-repository.js';
export type { IntegrationsDatabaseSchema } from './persistence/schema.js';
