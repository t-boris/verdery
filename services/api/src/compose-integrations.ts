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
  AnalyzePlantCondition,
  createOpenMeteoWeatherRegistration,
  GenerateAiExplanation,
  GetGardenWeather,
  IdentifyPlantSpecies,
  KyselyProviderQuotaRepository,
  KyselyWeatherRecordRepository,
  KyselyWeatherRefreshCandidateSource,
  RefreshGardenWeather,
  ResendTransactionalEmailAdapter,
  RunWeatherRefreshSweep,
  WeatherProviderRegistry,
} from './modules/integrations/public.js';
import type {
  AiExplanationProviderAdapter,
  PlantConditionAnalysisProviderAdapter,
  PlantSpeciesIdentificationProviderAdapter,
  TransactionalEmailAdapter,
  WeatherRefreshSweepRouteDependencies,
} from './modules/integrations/public.js';
import { KyselyGeoreferenceRepository } from './modules/gardens-mapping/public.js';
import type {
  AiExplanationConfiguration,
  PlantConditionAiConfiguration,
  PlantSpeciesAiConfiguration,
  TransactionalEmailConfiguration,
  WeatherConfiguration,
} from './platform/configuration/configuration-schema.js';
import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import type { Clock } from './shared/time/clock.js';

/**
 * The AI-explanation adapter's stable name (P7-AI-01) — its quota-
 * accounting key in the shared `provider_quota_usage` table and the
 * `provider_key` provenance on every stored AI-explanation record.
 */
export const AI_EXPLANATION_PROVIDER_KEY = 'vertex-ai-explanation';
/** ADR-0015: the plant-species-identification adapter's quota-accounting key and stored-suggestion provenance. */
export const PLANT_SPECIES_AI_PROVIDER_KEY = 'vertex-ai-plant-species';
/** ADR-0015: the plant-condition-analysis adapter's quota-accounting key and stored-observation provenance. */
export const PLANT_CONDITION_AI_PROVIDER_KEY = 'vertex-ai-plant-condition';

export interface IntegrationsComposition {
  /** Consumed by tasks-recommendations' `EvaluateGardenRecommendations` — the cross-module use-case injection precedent. */
  readonly getGardenWeather: GetGardenWeather;
  /** Consumed by tasks-recommendations' `EmbellishRecommendationExplanations` (P7-AI-01) — same precedent. Typed `noProviderConfigured` whenever the adapter is null. */
  readonly generateAiExplanation: GenerateAiExplanation;
  /** ADR-0015: consumed by plants-inventory's `AddPlantFromPhoto` — the same cross-module use-case injection precedent. Typed `noProviderConfigured` whenever the adapter is null (every environment today, pending the manual spot-check and provider-terms verification ADR-0015 names). */
  readonly identifyPlantSpecies: IdentifyPlantSpecies;
  /** ADR-0015: consumed by observations-history's `RecordObservation`/`CorrectObservation` — same precedent. */
  readonly analyzePlantCondition: AnalyzePlantCondition;
  readonly weatherRefreshSweepRouteDependencies: WeatherRefreshSweepRouteDependencies;
  /** P9C-INVITE-01: consumed by collaboration's `CreateClientInvitation` — the cross-module use-case injection precedent, again. `null` whenever `RESEND_API_KEY` is unconfigured. */
  readonly transactionalEmailAdapter: TransactionalEmailAdapter | null;
}

export function composeIntegrations(
  database: DatabaseGateway,
  clock: Clock,
  weather: WeatherConfiguration,
  aiExplanation: AiExplanationConfiguration,
  aiExplanationAdapter: AiExplanationProviderAdapter | null,
  plantSpeciesAi: PlantSpeciesAiConfiguration,
  plantSpeciesIdentificationAdapter: PlantSpeciesIdentificationProviderAdapter | null,
  plantConditionAi: PlantConditionAiConfiguration,
  plantConditionAnalysisAdapter: PlantConditionAnalysisProviderAdapter | null,
  transactionalEmail: TransactionalEmailConfiguration,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
  logger: FastifyBaseLogger,
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

  // ADR-0015: the bounded call machinery exists regardless of either
  // switch — with a null adapter (both off, every environment today) each
  // answers `noProviderConfigured`, the `generateAiExplanation` posture
  // above exactly.
  const identifyPlantSpecies = new IdentifyPlantSpecies(
    plantSpeciesIdentificationAdapter,
    {
      providerKey: PLANT_SPECIES_AI_PROVIDER_KEY,
      callTimeoutMs: plantSpeciesAi.callTimeoutMs,
      quotaLimits: {
        maxCallsPerHour: plantSpeciesAi.maxCallsPerHour,
        maxCallsPerDay: plantSpeciesAi.maxCallsPerDay,
      },
    },
    providerQuotas,
    clock,
    logger,
  );
  const analyzePlantCondition = new AnalyzePlantCondition(
    plantConditionAnalysisAdapter,
    {
      providerKey: PLANT_CONDITION_AI_PROVIDER_KEY,
      callTimeoutMs: plantConditionAi.callTimeoutMs,
      quotaLimits: {
        maxCallsPerHour: plantConditionAi.maxCallsPerHour,
        maxCallsPerDay: plantConditionAi.maxCallsPerDay,
      },
    },
    providerQuotas,
    clock,
    logger,
  );

  const getGardenWeather = new GetGardenWeather(weatherRecords, freshnessPolicy, clock);

  const weatherRefreshSweepRouteDependencies: WeatherRefreshSweepRouteDependencies = {
    runWeatherRefreshSweep: new RunWeatherRefreshSweep(
      new KyselyWeatherRefreshCandidateSource(database.queries),
      refreshGardenWeather,
    ),
    cloudTasksInvocationVerifier,
  };

  // P9C-INVITE-01 (transactional email: Resend, decided 2026-07-26 —
  // implementation-plan.md section 29.1.1). Built directly here, the same
  // "plain fetch, no SDK" posture Open-Meteo's own registration above takes
  // — unlike the Vertex AI adapter (an SDK client `main.ts` constructs),
  // nothing about one REST endpoint needs external construction. `null`
  // whenever `RESEND_API_KEY` is absent (every environment today): the
  // honest degradation `CreateClientInvitation` answers with, never a
  // silently-broken invitation.
  const transactionalEmailAdapter: TransactionalEmailAdapter | null =
    transactionalEmail.apiKey === null
      ? null
      : new ResendTransactionalEmailAdapter((url, init) => globalThis.fetch(url, init), {
          apiKey: transactionalEmail.apiKey,
          // The cross-field configuration check guarantees this is defined
          // whenever `apiKey` is (`findTransactionalEmailIssues`).
          fromEmail: transactionalEmail.fromEmail as string,
        });

  return {
    getGardenWeather,
    generateAiExplanation,
    identifyPlantSpecies,
    analyzePlantCondition,
    weatherRefreshSweepRouteDependencies,
    transactionalEmailAdapter,
  };
}
