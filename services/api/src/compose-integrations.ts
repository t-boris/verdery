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
  ApprovePlantAssertionReview,
  createGbifRegistration,
  createOpenMeteoWeatherRegistration,
  createUsaNpnRegistration,
  createUsdaPlantsRegistration,
  createWorldFloraOnlineRegistration,
  FindAddressCandidates,
  EnrichTaxonProfile,
  GBIF_PROVIDER_KEY,
  GenerateAiExplanation,
  GetGardenPrecipitation,
  GetGardenWeather,
  GetGardenWeatherView,
  IdentifyPlantSpecies,
  KyselyPlantDistributionAssertionRepository,
  KyselyPlantFactAssertionRepository,
  KyselyPlantMediaAssetRepository,
  KyselyPlantTaxonomyMappingRepository,
  KyselyProviderQuotaRepository,
  KyselyTaxonEnrichmentCandidateSource,
  KyselyTaxonomyIdentitySource,
  KyselyWeatherRecordRepository,
  KyselyWeatherRefreshCandidateSource,
  ListPlantAssertionsAwaitingReview,
  PlantAssertionProviderRegistry,
  RefreshGardenWeather,
  RefreshTaxonAssertions,
  ResendTransactionalEmailAdapter,
  RunTaxonEnrichmentSweep,
  RunWeatherRefreshSweep,
  NominatimGeocodingAdapter,
  USA_NPN_PROVIDER_KEY,
  USDA_PLANTS_PROVIDER_KEY,
  WeatherProviderRegistry,
  WORLD_FLORA_ONLINE_PROVIDER_KEY,
} from './modules/integrations/public.js';
import type { TaxonProfileEnricher } from './modules/plants-inventory/public.js';
import type {
  AddressGeocodingAdapter,
  AiExplanationProviderAdapter,
  GeocodingRoutesDependencies,
  PlantAssertionProviderRegistration,
  PlantAssertionReviewRoutesDependencies,
  PlantConditionAnalysisProviderAdapter,
  PlantSpeciesIdentificationProviderAdapter,
  TaxonEnrichmentSweepRouteDependencies,
  SeasonalTimingProposalProvider,
  TransactionalEmailAdapter,
  WeatherRefreshSweepRouteDependencies,
  WeatherRoutesDependencies,
} from './modules/integrations/public.js';
import type { GardenAuthorization } from './modules/gardens-mapping/public.js';
import { KyselyGeoreferenceRepository } from './modules/gardens-mapping/public.js';
import {
  KyselyPlantProfileVersionRepository,
  KyselySeasonalProposalCandidateSource,
  KyselyTaxonomySeasonalFactRepository,
  ProposeSeasonalTiming,
  RebuildPlantProfileVersion,
} from './modules/plants-inventory/public.js';
import type {
  AiExplanationConfiguration,
  PlantConditionAiConfiguration,
  PlantReviewConfiguration,
  PlantSpeciesAiConfiguration,
  TaxonKnowledgeConfiguration,
  TransactionalEmailConfiguration,
  WeatherConfiguration,
} from './platform/configuration/configuration-schema.js';
import type { FastifyBaseLogger } from 'fastify';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from './platform/tasks/cloud-tasks-invocation-verifier.js';
import { generateUuidV7 } from './shared/identifiers/uuid.js';
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
/** ADR-0013's proposal lane: its own quota-accounting key, so drafting spend is measurable apart from explanation spend even though both share a switch. */
export const SEASONAL_TIMING_PROVIDER_KEY = 'vertex-ai-seasonal-timing';

export interface IntegrationsComposition {
  /** Consumed by tasks-recommendations' `EvaluateGardenRecommendations` — the cross-module use-case injection precedent. */
  readonly getGardenWeather: GetGardenWeather;
  /** Consumed by tasks-recommendations' `EvaluateGardenRecommendations` for its rainfall-accumulation fact — the same cross-module use-case injection precedent. */
  readonly getGardenPrecipitation: GetGardenPrecipitation;
  /** Consumed by tasks-recommendations' `EmbellishRecommendationExplanations` (P7-AI-01) — same precedent. Typed `noProviderConfigured` whenever the adapter is null. */
  readonly generateAiExplanation: GenerateAiExplanation;
  /** ADR-0015: consumed by plants-inventory's `AddPlantFromPhoto` — the same cross-module use-case injection precedent. Typed `noProviderConfigured` whenever the adapter is null (every environment today, pending the manual spot-check and provider-terms verification ADR-0015 names). */
  readonly identifyPlantSpecies: IdentifyPlantSpecies;
  /** ADR-0015: consumed by observations-history's `RecordObservation`/`CorrectObservation` — same precedent. */
  readonly analyzePlantCondition: AnalyzePlantCondition;
  /** Cache-aside cited-fact and reference-image enrichment used by the taxon profile read. */
  readonly taxonProfileEnricher: TaxonProfileEnricher;
  /** P12-GEO-01: address search, the one interactive provider call in this module. */
  readonly geocodingRoutesDependencies: GeocodingRoutesDependencies;
  /** The client-facing garden weather read — see `get-garden-weather-view.ts`. */
  readonly weatherRoutesDependencies: WeatherRoutesDependencies;
  readonly weatherRefreshSweepRouteDependencies: WeatherRefreshSweepRouteDependencies;
  /** P11-ASYNC-01: the scheduled taxon-enrichment sweep's internal route dependencies — the `weatherRefreshSweepRouteDependencies` precedent, second instance. */
  readonly taxonEnrichmentSweepRouteDependencies: TaxonEnrichmentSweepRouteDependencies;
  /** P11-PROV-01: the horticultural-review surface's own route dependencies. */
  readonly plantAssertionReviewRoutesDependencies: PlantAssertionReviewRoutesDependencies;
  /** P9C-INVITE-01: consumed by collaboration's `CreateClientInvitation` — the cross-module use-case injection precedent, again. `null` whenever `RESEND_API_KEY` is unconfigured. */
  readonly transactionalEmailAdapter: TransactionalEmailAdapter | null;
}

export function composeIntegrations(
  database: DatabaseGateway,
  clock: Clock,
  /** Reused from `composeGardensMapping`, which runs first — the client-facing weather read authorizes `viewGarden` like every other garden read. */
  gardenAuthorization: GardenAuthorization,
  weather: WeatherConfiguration,
  aiExplanation: AiExplanationConfiguration,
  aiExplanationAdapter: AiExplanationProviderAdapter | null,
  /** ADR-0013's proposal lane. Shares the AI-explanation switch, since both are the same provider commitment and the same kill-switch decision. */
  seasonalTimingAdapter: SeasonalTimingProposalProvider | null,
  plantSpeciesAi: PlantSpeciesAiConfiguration,
  plantSpeciesIdentificationAdapter: PlantSpeciesIdentificationProviderAdapter | null,
  plantConditionAi: PlantConditionAiConfiguration,
  plantConditionAnalysisAdapter: PlantConditionAnalysisProviderAdapter | null,
  taxonKnowledge: TaxonKnowledgeConfiguration,
  plantReview: PlantReviewConfiguration,
  transactionalEmail: TransactionalEmailConfiguration,
  cloudTasksInvocationVerifier: CloudTasksInvocationVerifier,
  logger: FastifyBaseLogger,
  /**
   * P12-GEO-01. `null` builds the real US Census adapter — the production
   * path, since that service needs no key and no configuration. A test passes
   * its own so no suite ever reaches the network, which is the same reason
   * `aiExplanationAdapter` and its siblings are injected.
   */
  addressGeocoder: AddressGeocodingAdapter | null = null,
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

  // One stateless read-only instance shared by the refresh use case (which
  // needs coordinates to fetch AT ALL) and the client-facing read (which
  // needs to tell "no location set" apart from "not fetched yet").
  const georeferences = new KyselyGeoreferenceRepository(database.queries);

  const refreshGardenWeather = new RefreshGardenWeather(
    registry,
    { activeProviderKey: weather.activeProviderKey, freshnessPolicy },
    weatherRecords,
    providerQuotas,
    georeferences,
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
  const getGardenPrecipitation = new GetGardenPrecipitation(weatherRecords);

  // The client-facing read over that same use case. `activeProviderKey` is
  // passed so the response can report `noProviderConfigured` as a typed
  // reason rather than leaving a client to infer it from an empty body.
  const weatherRoutesDependencies: WeatherRoutesDependencies = {
    getGardenWeatherView: new GetGardenWeatherView(
      getGardenWeather,
      getGardenPrecipitation,
      gardenAuthorization,
      georeferences,
      weather.activeProviderKey,
      clock,
    ),
  };

  // P12-GEO-01: the geocoder needs no key and no configuration, so unlike
  // every other adapter here it is always present — there is no "provider not
  // configured" state to represent. `globalThis.fetch` is the platform's own,
  // per ADR-0009.
  //
  // Nominatim replaced the US Census geocoder on 2026-08-08 for one reason: a
  // European address could not be found at all, because the service it
  // replaced is a US federal one and US addresses are all it has. See
  // `nominatim-geocoding-adapter.ts` for the usage policy this obliges and how
  // it is met.
  //
  // The `User-Agent` is required by that policy and carries a contact, which
  // is what the operator asks for so they can reach whoever is making the
  // requests before blocking them.
  const geocodingRoutesDependencies: GeocodingRoutesDependencies = {
    findAddressCandidates: new FindAddressCandidates(
      addressGeocoder ??
        new NominatimGeocodingAdapter({
          fetch: (input, init) => globalThis.fetch(input, init),
          userAgent: 'Verdery/1.0 (+https://github.com/t-boris/verdery)',
        }),
    ),
  };

  const weatherRefreshSweepRouteDependencies: WeatherRefreshSweepRouteDependencies = {
    runWeatherRefreshSweep: new RunWeatherRefreshSweep(
      new KyselyWeatherRefreshCandidateSource(database.queries),
      refreshGardenWeather,
    ),
    cloudTasksInvocationVerifier,
  };

  // P11-ASYNC-01/P11-PROV-01: the taxon-enrichment pipeline. Four
  // registrations today — USDA PLANTS (P11-ASYNC-01's first pass) plus
  // GBIF, USA-NPN, and World Flora Online (P11-PROV-01) — each
  // kill-switched off by default, needing no API key, pushed in ADR-0016's
  // own selection order (taxonomy spine first, then US names/status, then
  // the two net-new evidence sources). `sourcePriority` is the list of
  // ENABLED provider keys in that same order — the list both
  // `RunTaxonEnrichmentSweep` calls against and `RebuildPlantProfileVersion`
  // ties-break with, per that sweep's own header.
  const assertionRegistrations: PlantAssertionProviderRegistration[] = [];
  const taxonSourcePriority: string[] = [];

  if (taxonKnowledge.worldFloraOnline.enabled) {
    assertionRegistrations.push(
      createWorldFloraOnlineRegistration(
        {
          fetchTimeoutMs: taxonKnowledge.worldFloraOnline.callTimeoutMs,
          quotaLimits: {
            maxCallsPerHour: taxonKnowledge.worldFloraOnline.maxCallsPerHour,
            maxCallsPerDay: taxonKnowledge.worldFloraOnline.maxCallsPerDay,
          },
        },
        (url, init) => globalThis.fetch(url, init),
      ),
    );
    taxonSourcePriority.push(WORLD_FLORA_ONLINE_PROVIDER_KEY);
  }
  if (taxonKnowledge.usdaPlants.enabled) {
    assertionRegistrations.push(
      createUsdaPlantsRegistration(
        {
          fetchTimeoutMs: taxonKnowledge.usdaPlants.callTimeoutMs,
          quotaLimits: {
            maxCallsPerHour: taxonKnowledge.usdaPlants.maxCallsPerHour,
            maxCallsPerDay: taxonKnowledge.usdaPlants.maxCallsPerDay,
          },
        },
        (url, init) => globalThis.fetch(url, init),
      ),
    );
    taxonSourcePriority.push(USDA_PLANTS_PROVIDER_KEY);
  }
  if (taxonKnowledge.gbif.enabled) {
    assertionRegistrations.push(
      createGbifRegistration(
        {
          fetchTimeoutMs: taxonKnowledge.gbif.callTimeoutMs,
          quotaLimits: {
            maxCallsPerHour: taxonKnowledge.gbif.maxCallsPerHour,
            maxCallsPerDay: taxonKnowledge.gbif.maxCallsPerDay,
          },
        },
        (url, init) => globalThis.fetch(url, init),
      ),
    );
    taxonSourcePriority.push(GBIF_PROVIDER_KEY);
  }
  if (taxonKnowledge.usaNpn.enabled) {
    assertionRegistrations.push(
      createUsaNpnRegistration(
        {
          fetchTimeoutMs: taxonKnowledge.usaNpn.callTimeoutMs,
          quotaLimits: {
            maxCallsPerHour: taxonKnowledge.usaNpn.maxCallsPerHour,
            maxCallsPerDay: taxonKnowledge.usaNpn.maxCallsPerDay,
          },
        },
        (url, init) => globalThis.fetch(url, init),
        clock,
      ),
    );
    taxonSourcePriority.push(USA_NPN_PROVIDER_KEY);
  }

  const assertionRegistry = new PlantAssertionProviderRegistry(assertionRegistrations);

  const refreshTaxonAssertions = new RefreshTaxonAssertions(
    assertionRegistry,
    new KyselyPlantTaxonomyMappingRepository(database.queries),
    new KyselyTaxonomyIdentitySource(database.queries),
    new KyselyPlantFactAssertionRepository(database.queries),
    new KyselyPlantDistributionAssertionRepository(database.queries),
    new KyselyPlantMediaAssetRepository(database.queries),
    providerQuotas,
    generateUuidV7,
    clock,
  );
  const rebuildPlantProfileVersion = new RebuildPlantProfileVersion(
    new KyselyPlantTaxonomyMappingRepository(database.queries),
    new KyselyPlantFactAssertionRepository(database.queries),
    new KyselyPlantProfileVersionRepository(database.queries),
    generateUuidV7,
    clock,
  );
  // ADR-0013's proposal lane. The adapter is INJECTED, like every other
  // Vertex adapter here — `main.ts` owns client construction so no test
  // suite can reach the network. `null` whenever the AI switch is off,
  // which is every environment but development.
  const proposeSeasonalTiming = new ProposeSeasonalTiming(
    seasonalTimingAdapter,
    new KyselySeasonalProposalCandidateSource(database.queries),
    new KyselyTaxonomySeasonalFactRepository(database.queries),
    providerQuotas,
    {
      providerKey: SEASONAL_TIMING_PROVIDER_KEY,
      callTimeoutMs: aiExplanation.callTimeoutMs,
      quotaLimits: {
        maxCallsPerHour: aiExplanation.maxCallsPerHour,
        maxCallsPerDay: aiExplanation.maxCallsPerDay,
      },
    },
    clock,
  );

  const taxonEnrichmentSweepRouteDependencies: TaxonEnrichmentSweepRouteDependencies = {
    runTaxonEnrichmentSweep: new RunTaxonEnrichmentSweep(
      new KyselyTaxonEnrichmentCandidateSource(database.queries),
      refreshTaxonAssertions,
      rebuildPlantProfileVersion,
      taxonSourcePriority,
      clock,
      // `null` when the switch is off: the phase does not exist and no
      // provider call can happen.
      seasonalTimingAdapter === null ? null : proposeSeasonalTiming,
    ),
    cloudTasksInvocationVerifier,
  };
  const taxonProfileEnricher = new EnrichTaxonProfile(
    refreshTaxonAssertions,
    rebuildPlantProfileVersion,
    taxonSourcePriority,
  );

  // P11-PROV-01: the horticultural-review surface — gated by
  // `plantReview.reviewerEmails` (empty in every environment today, the
  // honest "no reviewer configured" starting state `requirePlantReviewerAccess`
  // itself refuses).
  const plantAssertionReviewRoutesDependencies: PlantAssertionReviewRoutesDependencies = {
    listPlantAssertionsAwaitingReview: new ListPlantAssertionsAwaitingReview(
      new KyselyPlantFactAssertionRepository(database.queries),
      new KyselyPlantDistributionAssertionRepository(database.queries),
      new KyselyPlantTaxonomyMappingRepository(database.queries),
      plantReview.reviewerEmails,
    ),
    approvePlantAssertionReview: new ApprovePlantAssertionReview(
      new KyselyPlantFactAssertionRepository(database.queries),
      new KyselyPlantDistributionAssertionRepository(database.queries),
      plantReview.reviewerEmails,
      clock,
    ),
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
    getGardenPrecipitation,
    generateAiExplanation,
    identifyPlantSpecies,
    analyzePlantCondition,
    geocodingRoutesDependencies,
    weatherRoutesDependencies,
    weatherRefreshSweepRouteDependencies,
    taxonEnrichmentSweepRouteDependencies,
    taxonProfileEnricher,
    plantAssertionReviewRoutesDependencies,
    transactionalEmailAdapter,
  };
}
