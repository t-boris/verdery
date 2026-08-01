/**
 * Typed configuration SHAPE — the per-capability interfaces and the
 * `toApplicationConfiguration` assembly function, split out of
 * `configuration-schema.ts` for the same 600-line reason every sibling
 * split file gives (see that file's own comment on
 * `configuration-cross-field-issues.ts`). Re-exported from
 * `configuration-schema.ts` (`export * from './configuration-shape.js'`),
 * so every existing importer keeps importing from that one file unchanged.
 *
 * Source: architecture/backend-modular-monolith.md, section "10. Configuration".
 */

import type { AppCheckEnforcementMode } from '../app-check/app-check-enforcement.js';
import type { DeploymentEnvironment, RawEnvironment } from './configuration-schema.js';

export interface HttpConfiguration {
  readonly host: string;
  readonly port: number;
  readonly bodyLimitBytes: number;
  readonly allowedOrigins: readonly string[];
}

interface DatabasePoolTuning {
  readonly maxConnections: number;
  readonly connectionTimeoutMs: number;
  /**
   * Server-side statement timeout. Required so that a slow query cannot hold a
   * pooled connection for the lifetime of a Cloud Run instance.
   *
   * Source: architecture/backend-modular-monolith.md, section "17. Database Access".
   */
  readonly statementTimeoutMs: number;
}

export interface UrlDatabaseConfiguration extends DatabasePoolTuning {
  readonly mode: 'url';
  /** Connection string. Treated as a secret and never logged. */
  readonly url: string;
}

export interface CloudSqlIamDatabaseConfiguration extends DatabasePoolTuning {
  readonly mode: 'cloudSqlIam';
  /** `PROJECT_ID:REGION:INSTANCE`. Not a secret — it names a resource, not a credential. */
  readonly instanceConnectionName: string;
  /** The service's own Cloud SQL IAM database username. No password accompanies it. */
  readonly iamUser: string;
  readonly databaseName: string;
}

export type DatabaseConfiguration = UrlDatabaseConfiguration | CloudSqlIamDatabaseConfiguration;

/** Bucket names and access-TTL tuning for `MediaStorageGateway`. */
export interface MediaConfiguration {
  readonly buckets: {
    readonly userMedia: string;
    readonly rawCapture: string;
    readonly derived: string;
    readonly exports: string;
  };
  readonly uploadSessionTtlMs: number;
  readonly signedDownloadTtlMs: number;
  /** P6-ASYNC-01: the media-processing callback's own OIDC verification target. */
  readonly processingCallback: {
    readonly audience: string;
    readonly invokerServiceAccountEmail: string;
  };
}

/** The Open-Meteo host tier — a licensing choice, not only a routing one. */
export type OpenMeteoTierSetting = RawEnvironment['WEATHER_OPEN_METEO_TIER'];

/** P0-PROV-01 (weather half) — see the schema's own comment on the `WEATHER_OPEN_METEO_*` variables. */
export interface OpenMeteoConfiguration {
  readonly tier: OpenMeteoTierSetting;
  /** `null` on the keyless free tier; present whenever the tier is `customer` (the cross-field check). */
  readonly apiKey: string | null;
  readonly pastDays: number;
  readonly forecastDays: number;
}

/** P7-ASYNC-01 and P0-PROV-01 — see the schema's own comments on the `WEATHER_*` variables. */
export interface WeatherConfiguration {
  /** `'open-meteo'` selects the registered adapter; `null` keeps the honest `noProviderConfigured` degradation. */
  readonly activeProviderKey: string | null;
  readonly observationFreshForMs: number;
  readonly forecastFreshForMs: number;
  readonly callTimeoutMs: number;
  readonly maxCallsPerHour: number;
  readonly maxCallsPerDay: number;
  readonly openMeteo: OpenMeteoConfiguration;
}

/** P7-AI-01 — see the schema's own comment on the `RECOMMENDATION_AI_*` variables. */
export interface AiExplanationConfiguration {
  /** The kill-switch. `false` everywhere today: pure deterministic explanations, zero Vertex calls. */
  readonly enabled: boolean;
  /** Present whenever `enabled` (the cross-field check); `null` while disabled. */
  readonly vertexProjectId: string | null;
  readonly vertexLocation: string;
  /** Present whenever `enabled`; `null` while disabled — an explicitly evaluated choice, never a code default. */
  readonly model: string | null;
  readonly callTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxCallsPerHour: number;
  readonly maxCallsPerDay: number;
}

/** ADR-0015 — see the schema's own comment on the `PLANT_SPECIES_AI_*` variables. */
export interface PlantSpeciesAiConfiguration {
  /** The kill-switch. `false` everywhere today: the stub's honest "no suggestion" answer, zero Vertex calls. */
  readonly enabled: boolean;
  /** Present whenever `enabled` (the cross-field check); `null` while disabled — an explicitly evaluated choice, never a code default. */
  readonly model: string | null;
  readonly callTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxCallsPerHour: number;
  readonly maxCallsPerDay: number;
}

/** ADR-0015 — see the schema's own comment on the `PLANT_CONDITION_AI_*` variables. */
export interface PlantConditionAiConfiguration {
  /** The kill-switch. `false` everywhere today: the stub's honest placeholder answer, zero Vertex calls. */
  readonly enabled: boolean;
  readonly model: string | null;
  readonly callTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxCallsPerHour: number;
  readonly maxCallsPerDay: number;
}

interface TaxonKnowledgeProviderConfiguration {
  /** The kill-switch. `false` everywhere today: the registry has no registration for this provider, and it is absent from `sourcePriority`. */
  readonly enabled: boolean;
  readonly callTimeoutMs: number;
  readonly maxCallsPerHour: number;
  readonly maxCallsPerDay: number;
}

/** P11-ASYNC-01/P11-PROV-01 — see the schema's own comments on the `USDA_PLANTS_*`/`GBIF_*`/`USA_NPN_*`/`WORLD_FLORA_ONLINE_*` variables. */
export interface TaxonKnowledgeConfiguration {
  readonly usdaPlants: TaxonKnowledgeProviderConfiguration;
  readonly gbif: TaxonKnowledgeProviderConfiguration;
  readonly usaNpn: TaxonKnowledgeProviderConfiguration;
  readonly worldFloraOnline: TaxonKnowledgeProviderConfiguration;
}

/** P11-PROV-01 — see the schema's own comment on `PLANT_REVIEWER_EMAILS`. */
export interface PlantReviewConfiguration {
  /** Lower-cased, trimmed, verified-email allowlist. Empty means no reviewer is configured — the honest starting state. */
  readonly reviewerEmails: readonly string[];
}

/** P8-SEC-02 — see the schema's own comment on `APP_CHECK_ENFORCEMENT`. */
export interface AppCheckConfiguration {
  /** `'monitor'` everywhere today: classify and log, reject nothing. */
  readonly enforcement: AppCheckEnforcementMode;
}

/** P9C-INVITE-01 — see the schema's own comment on the `RESEND_*`/`CLIENT_PORTAL_BASE_URL` variables. */
export interface TransactionalEmailConfiguration {
  /** `null` everywhere today: no Resend account is provisioned yet. */
  readonly apiKey: string | null;
  /** Present whenever `apiKey` is (the cross-field check); `null` while absent. */
  readonly fromEmail: string | null;
  /** The client-portal origin an accept link is built against; present whenever `apiKey` is. */
  readonly clientPortalBaseUrl: string | null;
  readonly callTimeoutMs: number;
}

export interface ApplicationConfiguration {
  readonly environment: DeploymentEnvironment;
  readonly serviceVersion: string;
  readonly logLevel: RawEnvironment['LOG_LEVEL'];
  readonly http: HttpConfiguration;
  readonly database: DatabaseConfiguration;
  readonly shutdownGracePeriodMs: number;
  readonly firebaseProjectId: string;
  readonly media: MediaConfiguration;
  readonly weather: WeatherConfiguration;
  readonly aiExplanation: AiExplanationConfiguration;
  readonly plantSpeciesAi: PlantSpeciesAiConfiguration;
  readonly plantConditionAi: PlantConditionAiConfiguration;
  readonly taxonKnowledge: TaxonKnowledgeConfiguration;
  readonly plantReview: PlantReviewConfiguration;
  readonly appCheck: AppCheckConfiguration;
  readonly transactionalEmail: TransactionalEmailConfiguration;
}

function toDatabaseConfiguration(raw: RawEnvironment): DatabaseConfiguration {
  const tuning: DatabasePoolTuning = {
    maxConnections: raw.DATABASE_POOL_MAX_CONNECTIONS,
    connectionTimeoutMs: raw.DATABASE_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
  };

  if (raw.DATABASE_CONNECTION_MODE === 'url') {
    // The superRefine above guarantees this is defined whenever mode is 'url'.
    return { mode: 'url', url: raw.DATABASE_URL as string, ...tuning };
  }

  return {
    mode: 'cloudSqlIam',
    // The superRefine above guarantees these three are defined whenever mode
    // is 'cloudSqlIam'.
    instanceConnectionName: raw.DATABASE_INSTANCE_CONNECTION_NAME as string,
    iamUser: raw.DATABASE_IAM_USER as string,
    databaseName: raw.DATABASE_NAME as string,
    ...tuning,
  };
}

/** Shapes validated variables into the structure the composition root consumes. */
export function toApplicationConfiguration(raw: RawEnvironment): ApplicationConfiguration {
  return {
    environment: raw.VERDERY_ENVIRONMENT,
    serviceVersion: raw.SERVICE_VERSION,
    logLevel: raw.LOG_LEVEL,
    http: {
      host: raw.HTTP_HOST,
      port: raw.HTTP_PORT,
      bodyLimitBytes: raw.HTTP_BODY_LIMIT_BYTES,
      allowedOrigins: raw.HTTP_ALLOWED_ORIGINS,
    },
    database: toDatabaseConfiguration(raw),
    shutdownGracePeriodMs: raw.SHUTDOWN_GRACE_PERIOD_MS,
    firebaseProjectId: raw.FIREBASE_PROJECT_ID,
    media: {
      buckets: {
        userMedia: raw.MEDIA_USER_MEDIA_BUCKET,
        rawCapture: raw.MEDIA_RAW_CAPTURE_BUCKET,
        derived: raw.MEDIA_DERIVED_BUCKET,
        exports: raw.MEDIA_EXPORTS_BUCKET,
      },
      uploadSessionTtlMs: raw.MEDIA_UPLOAD_SESSION_TTL_MS,
      signedDownloadTtlMs: raw.MEDIA_SIGNED_DOWNLOAD_TTL_MS,
      processingCallback: {
        audience: raw.MEDIA_PROCESSING_CALLBACK_AUDIENCE,
        invokerServiceAccountEmail: raw.MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL,
      },
    },
    weather: {
      activeProviderKey: raw.WEATHER_ACTIVE_PROVIDER_KEY ?? null,
      observationFreshForMs: raw.WEATHER_OBSERVATION_FRESH_FOR_MS,
      forecastFreshForMs: raw.WEATHER_FORECAST_FRESH_FOR_MS,
      callTimeoutMs: raw.WEATHER_CALL_TIMEOUT_MS,
      maxCallsPerHour: raw.WEATHER_MAX_CALLS_PER_HOUR,
      maxCallsPerDay: raw.WEATHER_MAX_CALLS_PER_DAY,
      openMeteo: {
        tier: raw.WEATHER_OPEN_METEO_TIER,
        apiKey: raw.WEATHER_OPEN_METEO_API_KEY ?? null,
        pastDays: raw.WEATHER_OPEN_METEO_PAST_DAYS,
        forecastDays: raw.WEATHER_OPEN_METEO_FORECAST_DAYS,
      },
    },
    aiExplanation: {
      enabled: raw.RECOMMENDATION_AI_EXPLANATION_ENABLED,
      vertexProjectId: raw.RECOMMENDATION_AI_VERTEX_PROJECT_ID ?? null,
      vertexLocation: raw.RECOMMENDATION_AI_VERTEX_LOCATION,
      model: raw.RECOMMENDATION_AI_MODEL ?? null,
      callTimeoutMs: raw.RECOMMENDATION_AI_CALL_TIMEOUT_MS,
      maxOutputTokens: raw.RECOMMENDATION_AI_MAX_OUTPUT_TOKENS,
      maxCallsPerHour: raw.RECOMMENDATION_AI_MAX_CALLS_PER_HOUR,
      maxCallsPerDay: raw.RECOMMENDATION_AI_MAX_CALLS_PER_DAY,
    },
    plantSpeciesAi: {
      enabled: raw.PLANT_SPECIES_AI_ENABLED,
      model: raw.PLANT_SPECIES_AI_MODEL ?? null,
      callTimeoutMs: raw.PLANT_SPECIES_AI_CALL_TIMEOUT_MS,
      maxOutputTokens: raw.PLANT_SPECIES_AI_MAX_OUTPUT_TOKENS,
      maxCallsPerHour: raw.PLANT_SPECIES_AI_MAX_CALLS_PER_HOUR,
      maxCallsPerDay: raw.PLANT_SPECIES_AI_MAX_CALLS_PER_DAY,
    },
    plantConditionAi: {
      enabled: raw.PLANT_CONDITION_AI_ENABLED,
      model: raw.PLANT_CONDITION_AI_MODEL ?? null,
      callTimeoutMs: raw.PLANT_CONDITION_AI_CALL_TIMEOUT_MS,
      maxOutputTokens: raw.PLANT_CONDITION_AI_MAX_OUTPUT_TOKENS,
      maxCallsPerHour: raw.PLANT_CONDITION_AI_MAX_CALLS_PER_HOUR,
      maxCallsPerDay: raw.PLANT_CONDITION_AI_MAX_CALLS_PER_DAY,
    },
    taxonKnowledge: {
      usdaPlants: {
        enabled: raw.USDA_PLANTS_PROVIDER_ENABLED,
        callTimeoutMs: raw.USDA_PLANTS_CALL_TIMEOUT_MS,
        maxCallsPerHour: raw.USDA_PLANTS_MAX_CALLS_PER_HOUR,
        maxCallsPerDay: raw.USDA_PLANTS_MAX_CALLS_PER_DAY,
      },
      gbif: {
        enabled: raw.GBIF_PROVIDER_ENABLED,
        callTimeoutMs: raw.GBIF_CALL_TIMEOUT_MS,
        maxCallsPerHour: raw.GBIF_MAX_CALLS_PER_HOUR,
        maxCallsPerDay: raw.GBIF_MAX_CALLS_PER_DAY,
      },
      usaNpn: {
        enabled: raw.USA_NPN_PROVIDER_ENABLED,
        callTimeoutMs: raw.USA_NPN_CALL_TIMEOUT_MS,
        maxCallsPerHour: raw.USA_NPN_MAX_CALLS_PER_HOUR,
        maxCallsPerDay: raw.USA_NPN_MAX_CALLS_PER_DAY,
      },
      worldFloraOnline: {
        enabled: raw.WORLD_FLORA_ONLINE_PROVIDER_ENABLED,
        callTimeoutMs: raw.WORLD_FLORA_ONLINE_CALL_TIMEOUT_MS,
        maxCallsPerHour: raw.WORLD_FLORA_ONLINE_MAX_CALLS_PER_HOUR,
        maxCallsPerDay: raw.WORLD_FLORA_ONLINE_MAX_CALLS_PER_DAY,
      },
    },
    plantReview: {
      reviewerEmails: raw.PLANT_REVIEWER_EMAILS.map((email) => email.toLowerCase()),
    },
    appCheck: {
      enforcement: raw.APP_CHECK_ENFORCEMENT,
    },
    transactionalEmail: {
      apiKey: raw.RESEND_API_KEY ?? null,
      fromEmail: raw.RESEND_FROM_EMAIL ?? null,
      clientPortalBaseUrl: raw.CLIENT_PORTAL_BASE_URL ?? null,
      callTimeoutMs: raw.RESEND_CALL_TIMEOUT_MS,
    },
  };
}
