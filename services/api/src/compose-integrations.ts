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
  const registry = new WeatherProviderRegistry([]);
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
