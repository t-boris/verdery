/**
 * Typed configuration schema for the API service.
 *
 * Configuration is validated once at startup and never re-read per request, so
 * an invalid deployment fails immediately instead of failing on the first
 * request that happens to need the bad value.
 *
 * Source: architecture/backend-modular-monolith.md, section "10. Configuration".
 */

import { z } from 'zod';
import type { AppCheckEnforcementMode } from '../app-check/app-check-enforcement.js';

/** Deployment environments the service is built for. */
export type DeploymentEnvironment = 'development' | 'staging' | 'production';

/**
 * Environment variables whose values must never reach a log, an error message,
 * or telemetry.
 *
 * Source: architecture/observability-and-analytics.md, section
 * "6. Prohibited Telemetry".
 */
export const SECRET_VARIABLES: ReadonlySet<string> = new Set([
  'DATABASE_URL',
  // The Open-Meteo paid-plan key travels as a query parameter, so a
  // validator message quoting the offending value would print the credential.
  'WEATHER_OPEN_METEO_API_KEY',
]);

const positiveInteger = z.coerce.number().int().positive();

const durationMilliseconds = z.coerce.number().int().min(0);

/**
 * A duration that must stay genuinely short-lived: positive, and capped at
 * Cloud Storage's own V4 signing limit ("Max allowed expiration is seven
 * days" — `@google-cloud/storage`'s signer rejects more outright, so a
 * larger number buys nothing and only hides the mistake until a request
 * fails).
 *
 * Bounded rather than merely defaulted because an unbounded value silently
 * turns short-lived signed access — the only thing between a leaked URL and
 * open access to sensitive media — into a long-lived bearer credential, from
 * a single environment-variable typo nothing would reject.
 *
 * Source: threat-model.md, T-SIGN-07 (P8-SEC-01).
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const shortLivedDurationMilliseconds = z.coerce.number().int().positive().max(SEVEN_DAYS_MS);

/**
 * Comma-separated origin list. An empty value means "no cross-origin browser
 * client is allowed", which is the correct default for a service reached
 * through its own edge.
 */
const originList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

export const environmentSchema = z.object({
  VERDERY_ENVIRONMENT: z.enum(['development', 'staging', 'production']),
  SERVICE_VERSION: z.string().min(1).default('0.0.0-development'),

  HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  HTTP_PORT: positiveInteger.max(65_535).default(8080),
  HTTP_BODY_LIMIT_BYTES: positiveInteger.default(1_048_576),
  HTTP_ALLOWED_ORIGINS: originList,

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Firebase Authentication owns credentials; this service only verifies
  // tokens issued for this exact project. Required, not inferred from
  // Application Default Credentials' ambient project, so a misconfigured
  // deployment fails at startup rather than verifying tokens against the
  // wrong Firebase project.
  //
  // Source: architecture/identity-and-authorization.md, section
  // "2. Identity Authority".
  FIREBASE_PROJECT_ID: z.string().min(1),

  // Two ways to reach the database, matching the two places this service
  // runs:
  //
  // - 'url': an ordinary connection string with a password. Used for local
  //   development and the Testcontainers-backed test suite, neither of which
  //   has a Cloud SQL instance or a Google identity to authenticate with.
  // - 'cloudSqlIam': no password anywhere. The service authenticates to Cloud
  //   SQL as its own Google identity through the Cloud SQL connector, and
  //   Postgres authorizes that identity through membership in the
  //   verdery_application / verdery_migration NOLOGIN roles the migration
  //   creates.
  //
  // Source: services/api/migrations/1784710800000_platform-baseline.sql,
  // "Roles are group roles without LOGIN ... credentials never live here".
  DATABASE_CONNECTION_MODE: z.enum(['url', 'cloudSqlIam']).default('url'),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_INSTANCE_CONNECTION_NAME: z.string().min(1).optional(),
  DATABASE_IAM_USER: z.string().min(1).optional(),
  DATABASE_NAME: z.string().min(1).optional(),
  DATABASE_POOL_MAX_CONNECTIONS: positiveInteger.default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: durationMilliseconds.default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: durationMilliseconds.default(10_000),

  SHUTDOWN_GRACE_PERIOD_MS: durationMilliseconds.default(15_000),

  // The four private Cloud Storage buckets architecture/media-storage-and-
  // processing.md section 4 names, provisioned for `verdery-dev` by
  // infrastructure/gcloud/scripts/09-media-storage.sh. Real names, not
  // inferred: they differ per environment
  // (infrastructure/gcloud/config/dev.env's own `VERDERY_*_BUCKET`
  // variables), so a misconfigured deployment fails at startup rather than
  // silently writing to the wrong bucket.
  MEDIA_USER_MEDIA_BUCKET: z.string().min(1),
  MEDIA_RAW_CAPTURE_BUCKET: z.string().min(1),
  MEDIA_DERIVED_BUCKET: z.string().min(1),
  MEDIA_EXPORTS_BUCKET: z.string().min(1),

  // Section 18: "Signed access with short expiration" and section 7:
  // "Upload authorization is single-purpose, short-lived." No specific
  // duration is named anywhere in this repository's docs, so both are
  // reasoned defaults, documented here — the same "no number decided yet,
  // pick one and say so" posture `09-media-storage.sh`'s own export-bucket
  // lifecycle rule already sets. One hour gives a client enough time to
  // begin a resumable upload after registration without holding a
  // long-lived credential open; fifteen minutes is a standard short-lived
  // window for a signed read URL.
  MEDIA_UPLOAD_SESSION_TTL_MS: shortLivedDurationMilliseconds.default(3_600_000),
  MEDIA_SIGNED_DOWNLOAD_TTL_MS: shortLivedDurationMilliseconds.default(900_000),

  // P6-ASYNC-01: the media-processing callback Cloud Tasks invokes
  // (`POST /v1/internal/media-processing-jobs/:jobId/callback`).
  // `MEDIA_PROCESSING_CALLBACK_AUDIENCE` is the exact URL the relay's Cloud
  // Tasks queue was configured to call and the OIDC token's own `aud` claim
  // must match; `MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL` is the one
  // service account this deployment's queue mints tokens for. Neither is a
  // secret — both name resources, not credentials, the same reasoning
  // `instanceConnectionName` above already documents for Cloud SQL.
  //
  // Source: architecture/asynchronous-processing.md, section
  // "17. Security"; infrastructure/gcloud/scripts/10-media-processing-queue.sh
  // (drafted, not yet run against any real environment).
  MEDIA_PROCESSING_CALLBACK_AUDIENCE: z.string().min(1),
  MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL: z.string().min(1),

  // P7-ASYNC-01: the weather integration's environment configuration, needed
  // the moment the composition root first wires `RefreshGardenWeather`/
  // `GetGardenWeather` (P7-INT-01 built both constructor-injected and
  // deliberately unnumbered; this is the implementation-time selection its
  // own comments deferred to).
  //
  // `WEATHER_ACTIVE_PROVIDER_KEY` is absent in every environment today — no
  // weather vendor exists (P0-PROV-01 undecided), and the honest runtime
  // outcome is the typed `noProviderConfigured` degradation. Setting it to a
  // key with no registration fails at startup construction, by design.
  //
  // The freshness windows double as the cache windows (weather-freshness.ts:
  // "the freshness window IS the cache window"). No document names either
  // number, so both are reasoned defaults, documented here — the same "no
  // number decided yet, pick one and say so" posture
  // `MEDIA_UPLOAD_SESSION_TTL_MS` already sets. One hour for observations:
  // providers typically publish hourly readings, so refetching sooner buys
  // nothing and spends quota. Six hours for forecasts: forecast models
  // typically refresh a few times per day, and the frost-watch rule (the one
  // forecast consumer) declares `skip` on stale data — six hours keeps it
  // usable across a worker sweep cycle without pretending forecasts change
  // by the hour.
  WEATHER_ACTIVE_PROVIDER_KEY: z.string().min(1).optional(),
  WEATHER_OBSERVATION_FRESH_FOR_MS: positiveInteger.default(3_600_000),
  WEATHER_FORECAST_FRESH_FOR_MS: positiveInteger.default(21_600_000),

  // P0-PROV-01 (weather half, decided 2026-07-26): Open-Meteo is the
  // selected provider, so the registry now has a real registration and these
  // are the numbers section 3's adapter contract leaves to configuration —
  // the strict per-call deadline and the two call budgets. Reasoned
  // defaults in the established "no number decided yet, pick one and say so"
  // posture: 8 s bounds a sweep-phase call; the budgets sit far under the
  // paid Standard plan's allowance while still capping a runaway sweep.
  WEATHER_CALL_TIMEOUT_MS: positiveInteger.default(8_000),
  WEATHER_MAX_CALLS_PER_HOUR: positiveInteger.default(300),
  WEATHER_MAX_CALLS_PER_DAY: positiveInteger.default(3_000),

  // The two Open-Meteo hosts, chosen by tier rather than by a free-form URL
  // so a typo cannot silently point production at a differently-licensed
  // endpoint (the `DATABASE_CONNECTION_MODE` enum precedent):
  //
  // - `free`     — api.open-meteo.com, no key, NON-COMMERCIAL use only.
  //                The default, and what development runs on today: there is
  //                no paid key in any environment yet.
  // - `customer` — customer-api.open-meteo.com with `WEATHER_OPEN_METEO_API_KEY`,
  //                the paid Standard plan. Required together
  //                (`findWeatherProviderIssues`), because a paid host without
  //                a key rejects every request.
  //
  // The licence stamped on stored rows differs between the two, so the tier
  // is a licensing decision, not only a routing one. The pinned NOAA model
  // list is deliberately NOT here — it decides which licence the data
  // carries, so it stays a reviewed code constant
  // (`open-meteo-payload.ts`).
  //
  // Day windows: 7 past days is the recent-rainfall input the watering rules
  // read (model-analysed precipitation, labeled as such on every row), and 7
  // forecast days covers the frost-watch horizon. Both are bounded by what
  // the API itself accepts.
  WEATHER_OPEN_METEO_TIER: z.enum(['free', 'customer']).default('free'),
  WEATHER_OPEN_METEO_API_KEY: z.string().min(1).optional(),
  WEATHER_OPEN_METEO_PAST_DAYS: z.coerce.number().int().min(0).max(92).default(7),
  WEATHER_OPEN_METEO_FORECAST_DAYS: z.coerce.number().int().min(1).max(16).default(7),

  // P7-AI-01: the bounded Vertex AI explanation embellishment.
  //
  // `RECOMMENDATION_AI_EXPLANATION_ENABLED` is the KILL-SWITCH — section
  // 16's "versioned feature flag" made operational. Off (the default, and
  // the state of every environment today — no Vertex access is enabled on
  // verdery-dev): no GenAI client is constructed, the sweep's
  // embellishment phase does not exist, the Today read path never touches
  // the verdict table, and behavior is exactly the pre-P7-AI-01 baseline.
  // Flipping it off IS the rollback; the model/prompt versions stored on
  // every record are what evaluation compares across flips.
  //
  // When enabled, the project id and MODEL are required (checked by
  // `findAiExplanationIssues` — a model identifier is a section-16
  // evaluated release decision, so code never invents a default one).
  // The location defaults to the ADR-0007 regional baseline. Timeout,
  // token budget, and the two call-budget windows are reasoned defaults
  // in the established "no number decided yet, pick one and say so"
  // posture: 10 s bounds a sweep-phase call without hanging the run;
  // 512 tokens is ample for a "concise" explanation (section 8's token
  // budget) and, with the call caps, bounds spend per window (calls x
  // bounded tokens = the cost ceiling, external-integrations.md
  // section 14).
  RECOMMENDATION_AI_EXPLANATION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RECOMMENDATION_AI_VERTEX_PROJECT_ID: z.string().min(1).optional(),
  RECOMMENDATION_AI_VERTEX_LOCATION: z.string().min(1).default('us-central1'),
  RECOMMENDATION_AI_MODEL: z.string().min(1).optional(),
  RECOMMENDATION_AI_CALL_TIMEOUT_MS: positiveInteger.default(10_000),
  RECOMMENDATION_AI_MAX_OUTPUT_TOKENS: positiveInteger.default(512),
  RECOMMENDATION_AI_MAX_CALLS_PER_HOUR: positiveInteger.default(50),
  RECOMMENDATION_AI_MAX_CALLS_PER_DAY: positiveInteger.default(500),

  // P8-SEC-02: the App Check enforcement switch — rollout stage 3 made
  // operational, in exactly the shape `RECOMMENDATION_AI_EXPLANATION_ENABLED`
  // above already established for a capability that is built before it is
  // turned on.
  //
  // `monitor` (the default, and the state of every environment today):
  // classify every request and log the outcome, reject nothing. Identical
  // observable behavior to the pre-P8-SEC-02 service, with one addition — the
  // log line now also carries `outcome: 'wouldReject'` whenever enforcement
  // WOULD have refused the request, which is the telemetry the flip decision
  // has been blocked on.
  //
  // `enforce`: additionally reject a missing or invalid App Check token, and
  // ONLY on `APP_CHECK_ENFORCED_ENDPOINTS` — a reviewed list that lives in
  // code (platform/app-check/app-check-enforcement.ts), not here. What is
  // protected is a code change that goes through review; whether protection
  // is active is this variable. Flipping it back to `monitor` IS the
  // rollback, and needs no deployment of new code.
  //
  // Deliberately not a boolean: `APP_CHECK_ENFORCEMENT=monitor` reads as a
  // state an operator can reason about in a runbook, where
  // `APP_CHECK_ENFORCEMENT_ENABLED=false` reads as an absence.
  APP_CHECK_ENFORCEMENT: z.enum(['monitor', 'enforce']).default('monitor'),
});

export type RawEnvironment = z.infer<typeof environmentSchema>;

/** One configuration problem, in the shape `load-configuration.ts` merges with zod's own issues. */
export interface ConfigurationIssue {
  readonly variable: string;
  readonly message: string;
}

/**
 * Finds "required in this connection mode" problems that a flat zod object
 * cannot express as a per-field rule.
 *
 * Deliberately reads the RAW, unparsed source rather than a zod-validated
 * result. A `superRefine` on the schema would only run once every other field
 * already parsed without issues, which would silently hide a missing
 * DATABASE_URL whenever an unrelated variable (say HTTP_PORT) was also
 * invalid — the opposite of this module's stated goal of naming every
 * offending variable together. Reading raw presence has no such dependency.
 */
export function findDatabaseModeIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  const mode = source['DATABASE_CONNECTION_MODE'] === 'cloudSqlIam' ? 'cloudSqlIam' : 'url';

  const requiredFields =
    mode === 'url'
      ? (['DATABASE_URL'] as const)
      : (['DATABASE_INSTANCE_CONNECTION_NAME', 'DATABASE_IAM_USER', 'DATABASE_NAME'] as const);

  return requiredFields
    .filter((field) => source[field] === undefined)
    .map((field) => ({
      variable: field,
      message: `Required when DATABASE_CONNECTION_MODE is "${mode}"`,
    }));
}

/**
 * Cross-field rule for the AI-explanation switch, the
 * `findDatabaseModeIssues` shape (and its same raw-source reasoning):
 * enabling the capability requires the Vertex project and an explicitly
 * chosen model — neither has a value code may invent.
 */
export function findAiExplanationIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  if (source['RECOMMENDATION_AI_EXPLANATION_ENABLED'] !== 'true') {
    return [];
  }

  return (['RECOMMENDATION_AI_VERTEX_PROJECT_ID', 'RECOMMENDATION_AI_MODEL'] as const)
    .filter((field) => source[field] === undefined)
    .map((field) => ({
      variable: field,
      message: 'Required when RECOMMENDATION_AI_EXPLANATION_ENABLED is "true"',
    }));
}

/**
 * Cross-field rule for the Open-Meteo tier, the `findDatabaseModeIssues`
 * shape (and its same raw-source reasoning): the paid host authenticates by
 * `apikey` and rejects every keyless request, so selecting it without a key
 * is a deployment mistake to name at startup, not at the first sweep.
 */
export function findWeatherProviderIssues(
  source: Readonly<Record<string, string | undefined>>,
): ConfigurationIssue[] {
  if (source['WEATHER_OPEN_METEO_TIER'] !== 'customer') {
    return [];
  }
  if (source['WEATHER_OPEN_METEO_API_KEY'] !== undefined) {
    return [];
  }
  return [
    {
      variable: 'WEATHER_OPEN_METEO_API_KEY',
      message: 'Required when WEATHER_OPEN_METEO_TIER is "customer"',
    },
  ];
}

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

/** P8-SEC-02 — see the schema's own comment on `APP_CHECK_ENFORCEMENT`. */
export interface AppCheckConfiguration {
  /** `'monitor'` everywhere today: classify and log, reject nothing. */
  readonly enforcement: AppCheckEnforcementMode;
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
  readonly appCheck: AppCheckConfiguration;
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
    appCheck: {
      enforcement: raw.APP_CHECK_ENFORCEMENT,
    },
  };
}
