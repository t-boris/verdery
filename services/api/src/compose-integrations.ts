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
 * The registry now holds exactly ONE registration: Open-Meteo, the weather
 * half of P0-PROV-01 decided on 2026-07-26. It is exactly the change
 * P7-INT-01 predicted — one adapter class, one registration added HERE, one
 * configuration key — and nothing else moved.
 *
 * Registered is not the same as ACTIVE: `weather.activeProviderKey`
 * (`WEATHER_ACTIVE_PROVIDER_KEY`) still selects, and where it is unset the
 * sweep keeps degrading to the typed `noProviderConfigured` outcome. The
 * registration itself is keyless-safe: the default free tier needs no API
 * key, so development composes without one.
 */

import {
  createOpenMeteoWeatherRegistration,
  GenerateAiExplanation,
  GetGardenWeather,
  KyselyProviderQuotaRepository,
  KyselyWeatherRecordRepository,
  KyselyWeatherRefreshCandidateSource,
  RefreshGardenWeather,
  RunWeatherRefreshSweep,
  WeatherProviderRegistry,
} from './modules/integrations/public.js';
import type {
  AiExplanationProviderAdapter,
  WeatherRefreshSweepRouteDependencies,
} from './modules/integrations/public.js';
import { KyselyGeoreferenceRepository } from './modules/gardens-mapping/public.js';
import type {
  AiExplanationConfiguration,
  WeatherConfiguration,
} from './platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

/**
 * The AI-explanation adapter's stable name (P7-AI-01) — its quota-
 * accounting key in the shared `provider_quota_usage` table and the
 * `provider_key` provenance on every stored AI-explanation record.
 */
export const AI_EXPLANATION_PROVIDER_KEY = 'vertex-ai-explanation';

export interface IntegrationsComposition {
  /** Consumed by tasks-recommendations' `EvaluateGardenRecommendations` — the cross-module use-case injection precedent. */
  readonly getGardenWeather: GetGardenWeather;
  /** Consumed by tasks-recommendations' `EmbellishRecommendationExplanations` (P7-AI-01) — same precedent. Typed `noProviderConfigured` whenever the adapter is null. */
  readonly generateAiExplanation: GenerateAiExplanation;
  readonly weatherRefreshSweepRouteDependencies: WeatherRefreshSweepRouteDependencies;
}

export function composeIntegrations(
  database: DatabaseGateway,
  clock: Clock,
  weather: WeatherConfiguration,
  aiExplanation: AiExplanationConfiguration,
  aiExplanationAdapter: AiExplanationProviderAdapter | null,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
): IntegrationsComposition {
  // `globalThis.fetch` is the platform's own HTTP client (Node 24,
  // ADR-0009); no HTTP dependency is added for one REST provider.
  const registry = new WeatherProviderRegistry([
    createOpenMeteoWeatherRegistration(
      {
        configuration: weather.openMeteo,
        fetchTimeoutMs: weather.callTimeoutMs,
        quotaLimits: {
          maxCallsPerHour: weather.maxCallsPerHour,
          maxCallsPerDay: weather.maxCallsPerDay,
        },
      },
      (url, init) => globalThis.fetch(url, init),
      clock,
    ),
  ]);
  const weatherRecords = new KyselyWeatherRecordRepository(database.queries);
  const providerQuotas = new KyselyProviderQuotaRepository(database.queries);
  const freshnessPolicy = {
    observationFreshForMs: weather.observationFreshForMs,
    forecastFreshForMs: weather.forecastFreshForMs,
  };

  const refreshGardenWeather = new RefreshGardenWeather(
    registry,
    { activeProviderKey: weather.activeProviderKey, freshnessPolicy },
    weatherRecords,
    providerQuotas,
    new KyselyGeoreferenceRepository(database.queries),
    clock,
  );

  // P7-AI-01: the bounded call machinery exists regardless of the switch
  // — with a null adapter (the switch off, every environment today) it
  // answers `noProviderConfigured`, and its one caller (the sweep's
  // embellishment phase) is itself only composed when the switch is on.
  const generateAiExplanation = new GenerateAiExplanation(
    aiExplanationAdapter,
    {
      providerKey: AI_EXPLANATION_PROVIDER_KEY,
      callTimeoutMs: aiExplanation.callTimeoutMs,
      quotaLimits: {
        maxCallsPerHour: aiExplanation.maxCallsPerHour,
        maxCallsPerDay: aiExplanation.maxCallsPerDay,
      },
    },
    providerQuotas,
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

  return { getGardenWeather, generateAiExplanation, weatherRefreshSweepRouteDependencies };
}
