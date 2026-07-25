/**
 * Public interface of the integrations module — backend-modular-monolith.md
 * section 6.9's module ("provider adapters, normalized external
 * observations, quota policy, licensing metadata"), first materialized by
 * P7-INT-01 with its weather half.
 *
 * Other modules and the composition root may import only from this file.
 * Two audiences, named per this codebase's convention:
 *
 * - Other modules: tasks-recommendations' `EvaluateGardenRecommendations`
 *   consumes `GetGardenWeather` (the cross-module use-case injection
 *   precedent, P7-RULE-01).
 * - The composition root: `compose-integrations.ts` (P7-ASYNC-01) wires the
 *   registry, both use cases, the Kysely adapters, and the weather-refresh
 *   sweep + its internal route — the first callers P7-INT-01 built this
 *   module's exports for.
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

// P7-ASYNC-01: the scheduled weather-refresh sweep and its internal route.
export {
  RunWeatherRefreshSweep,
  WEATHER_REFRESH_SWEEP_BATCH_LIMIT,
} from './application/run-weather-refresh-sweep.js';
export type {
  GardenWeatherRefresher,
  WeatherRefreshSweepResult,
} from './application/run-weather-refresh-sweep.js';
export type { WeatherRefreshCandidateSource } from './application/weather-refresh-candidate-source.js';
export { registerWeatherRefreshSweepRoute } from './transport/weather-refresh-sweep-route.js';
export type { WeatherRefreshSweepRouteDependencies } from './transport/weather-refresh-sweep-route.js';

export { KyselyWeatherRecordRepository } from './persistence/kysely-weather-record-repository.js';
export { KyselyProviderQuotaRepository } from './persistence/kysely-provider-quota-repository.js';
export { KyselyWeatherRefreshCandidateSource } from './persistence/kysely-weather-refresh-candidate-source.js';
export type { IntegrationsDatabaseSchema } from './persistence/schema.js';
