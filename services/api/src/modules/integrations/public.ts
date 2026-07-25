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
 * P7-INT-02 lands the module's plant-content half under the same blocker
 * posture: the taxonomy-mapping and content domain models, the
 * plant-content provider port/registry, the `MapPlantTaxonomy` /
 * `RefreshPlantContent` / `GetPlantContent` use cases, and their Kysely
 * adapters. DELIBERATELY UNWIRED: no composition-root caller exists yet —
 * no document names a client-facing plant-content surface this phase, and
 * no scheduler consumes it (unlike weather, which P7-ASYNC-01 sweeps) — so
 * the exports below wait for the first consuming stage, the exact
 * P7-INT-01-before-P7-ASYNC-01 posture. See
 * `docs/development/deferred-capabilities.md`.
 *
 * P7-AI-01 lands the module's third capability: the AI-explanation
 * provider port, the `GenerateAiExplanation` bounded-call machinery
 * (budget, deadline, typed degradations), and the REAL Vertex adapter
 * over `@google/genai` — the first capability here whose vendor is
 * decided (ADR-0008 commits to Vertex AI), so it ships an adapter and no
 * registry. Runtime state everywhere today: the
 * `RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch is off, no client
 * is constructed, and every call path answers with the typed
 * `noProviderConfigured` degradation.
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
  WeatherProviderRegistration,
} from './application/weather-provider-registry.js';
export type { WeatherRecordRepository } from './application/weather-record-repository.js';
export { quotaWindowStart } from './application/provider-quota-repository.js';
export type {
  ProviderQuotaConsumeResult,
  ProviderQuotaLimits,
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

// P7-INT-02: the plant-content half — domain model, provider port/registry,
// use cases, and adapters. Unwired until the first consuming stage (see the
// header comment).
export {
  createPlantContentRecord,
  validatePlantContentSections,
  validatePlantContentSource,
} from './domain/plant-content-record.js';
export type {
  CreatePlantContentRecordInput,
  PlantContentRecord,
  PlantContentSections,
  PlantContentSource,
} from './domain/plant-content-record.js';
export {
  createPlantTaxonomyMapping,
  validateMappingConfidence,
  validateMappingStateTransition,
} from './domain/plant-taxonomy-mapping.js';
export type {
  CreatePlantTaxonomyMappingInput,
  PlantTaxonomyMapping,
  TaxonomyMappingVerificationState,
} from './domain/plant-taxonomy-mapping.js';

export type {
  NormalizedPlantContent,
  PlantContentProviderAdapter,
  ProviderTaxonCandidate,
  TaxonomyIdentityQuery,
} from './application/plant-content-provider.js';
export { PlantContentProviderRegistry } from './application/plant-content-provider-registry.js';
export type {
  PlantContentProviderMetadata,
  PlantContentProviderRegistration,
} from './application/plant-content-provider-registry.js';
export type { PlantContentRecordRepository } from './application/plant-content-record-repository.js';
export type { PlantTaxonomyMappingRepository } from './application/plant-taxonomy-mapping-repository.js';
export type { TaxonomyIdentitySource } from './application/taxonomy-identity-source.js';

export { MapPlantTaxonomy } from './application/map-plant-taxonomy.js';
export type {
  MapPlantTaxonomyConfiguration,
  MapPlantTaxonomyInput,
  MapPlantTaxonomyResult,
  MapPlantTaxonomyUnavailableReason,
} from './application/map-plant-taxonomy.js';
export {
  RefreshPlantContent,
  validatePlantContentRefetchPolicy,
} from './application/refresh-plant-content.js';
export type {
  PlantContentRefetchPolicy,
  PlantContentUnavailableReason,
  RefreshPlantContentConfiguration,
  RefreshPlantContentInput,
  RefreshPlantContentResult,
} from './application/refresh-plant-content.js';
export { GetPlantContent } from './application/get-plant-content.js';
export type {
  GetPlantContentInput,
  GetPlantContentResult,
  PlantContentAbsenceReason,
} from './application/get-plant-content.js';

// P7-AI-01: the AI-explanation capability — the provider-neutral port,
// the bounded call machinery (budget + deadline + typed degradations),
// and the real Vertex adapter. `GenerateAiExplanation` is consumed by
// tasks-recommendations' embellishment use case (the `GetGardenWeather`
// cross-module use-case injection precedent); the adapter itself is
// constructed only by `main.ts`, and ONLY when the
// `RECOMMENDATION_AI_EXPLANATION_ENABLED` kill-switch is on — off (every
// environment today) means no client, no adapter, zero Vertex calls.
export type {
  AiExplanationAdapterOutcome,
  AiExplanationDraft,
  AiExplanationEvidenceFact,
  AiExplanationLocale,
  AiExplanationModelIdentity,
  AiExplanationProviderAdapter,
  AiExplanationRequest,
} from './application/ai-explanation-provider.js';
export { GenerateAiExplanation } from './application/generate-ai-explanation.js';
export type {
  AiExplanationCallPolicy,
  AiExplanationProvenance,
  AiExplanationUnavailableReason,
  GenerateAiExplanationResult,
} from './application/generate-ai-explanation.js';
export {
  VERTEX_EXPLANATION_PROMPT_TEMPLATE_VERSION,
  VertexAiExplanationAdapter,
} from './persistence/vertex-ai-explanation-adapter.js';
export type {
  VertexAiExplanationAdapterConfiguration,
  VertexGenerativeClient,
} from './persistence/vertex-ai-explanation-adapter.js';

export { KyselyWeatherRecordRepository } from './persistence/kysely-weather-record-repository.js';
export { KyselyProviderQuotaRepository } from './persistence/kysely-provider-quota-repository.js';
export { KyselyWeatherRefreshCandidateSource } from './persistence/kysely-weather-refresh-candidate-source.js';
export { KyselyPlantTaxonomyMappingRepository } from './persistence/kysely-plant-taxonomy-mapping-repository.js';
export { KyselyPlantContentRecordRepository } from './persistence/kysely-plant-content-record-repository.js';
export { KyselyTaxonomyIdentitySource } from './persistence/kysely-taxonomy-identity-source.js';
export type { IntegrationsDatabaseSchema } from './persistence/schema.js';
