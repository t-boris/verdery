/**
 * Composition-root helper for the integrations module's weather surface
 * (P7-ASYNC-01) — split out of `app.ts` for the same 600-line reason
 * `compose-media.ts` was. Still composition-root code, not a module
 * boundary.
 *
 * This is the wiring P7-INT-01 deliberately left unwired ("no app.ts change
 * until a stage has a command to wire"): the provider registry, the two
 * weather use cases, and the scheduled weather-refresh sweep with its
 * internal machine-to-machine route.
 *
 * The registry is constructed with ZERO registrations — no weather vendor
 * exists (P0-PROV-01 undecided), `weather.activeProviderKey` is null in
 * every environment, and every sweep run degrades to the typed
 * `noProviderConfigured` outcome by design. Selecting a vendor later means:
 * one adapter class, one registration added HERE, one configuration key —
 * nothing else moves (the P7-INT-01 replacement tests prove it).
 */

import {
  GetGardenWeather,
  KyselyProviderQuotaRepository,
  KyselyWeatherRecordRepository,
  KyselyWeatherRefreshCandidateSource,
  RefreshGardenWeather,
  RunWeatherRefreshSweep,
  WeatherProviderRegistry,
} from './modules/integrations/public.js';
import type { WeatherRefreshSweepRouteDependencies } from './modules/integrations/public.js';
import { KyselyGeoreferenceRepository } from './modules/gardens-mapping/public.js';
import type { WeatherConfiguration } from './platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

export interface IntegrationsComposition {
  /** Consumed by tasks-recommendations' `EvaluateGardenRecommendations` — the cross-module use-case injection precedent. */
  readonly getGardenWeather: GetGardenWeather;
  readonly weatherRefreshSweepRouteDependencies: WeatherRefreshSweepRouteDependencies;
}

export function composeIntegrations(
  database: DatabaseGateway,
  clock: Clock,
  weather: WeatherConfiguration,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
): IntegrationsComposition {
  const registry = new WeatherProviderRegistry([]);
  const weatherRecords = new KyselyWeatherRecordRepository(database.queries);
  const freshnessPolicy = {
    observationFreshForMs: weather.observationFreshForMs,
    forecastFreshForMs: weather.forecastFreshForMs,
  };

  const refreshGardenWeather = new RefreshGardenWeather(
    registry,
    { activeProviderKey: weather.activeProviderKey, freshnessPolicy },
    weatherRecords,
    new KyselyProviderQuotaRepository(database.queries),
    new KyselyGeoreferenceRepository(database.queries),
    clock,
  );

  const getGardenWeather = new GetGardenWeather(weatherRecords, freshnessPolicy, clock);

  const weatherRefreshSweepRouteDependencies: WeatherRefreshSweepRouteDependencies = {
    runWeatherRefreshSweep: new RunWeatherRefreshSweep(
      new KyselyWeatherRefreshCandidateSource(database.queries),
      refreshGardenWeather,
    ),
    cloudTasksInvocationVerifier,
  };

  return { getGardenWeather, weatherRefreshSweepRouteDependencies };
}
