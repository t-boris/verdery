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
  // The Resend API key travels as a bearer header (P9C-INVITE-01).
  'RESEND_API_KEY',
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

  // ADR-0015: real plant photo identification and condition tracking,
  // replacing the `identify-plant-from-photo.ts`/`image-analysis-result.ts`
  // stubs. Two independent kill-switches (not one shared flag) because the
  // two capabilities can clear their own manual spot-check and provider-
  // terms verification at different times — flipping one must never imply
  // the other is also validated. Both default to `false` on every
  // environment today, the exact `RECOMMENDATION_AI_EXPLANATION_ENABLED`
  // posture: no GenAI client constructed for either use case, both
  // `identify-plant-from-photo.ts`/`analyzeObservationPhoto` answer with
  // the honest `noProviderConfigured`-shaped degradation. Both reuse the
  // same Vertex project/location as the recommendation-explanation
  // capability (one GCP project, `RECOMMENDATION_AI_VERTEX_PROJECT_ID`/
  // `_LOCATION`) since all three are the same provider commitment
  // (ADR-0008); each still requires its OWN explicitly evaluated model
  // identifier, never a shared default, matching `RECOMMENDATION_AI_MODEL`'s
  // own reasoning.
  PLANT_SPECIES_AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PLANT_SPECIES_AI_MODEL: z.string().min(1).optional(),
  PLANT_SPECIES_AI_CALL_TIMEOUT_MS: positiveInteger.default(10_000),
  PLANT_SPECIES_AI_MAX_OUTPUT_TOKENS: positiveInteger.default(256),
  PLANT_SPECIES_AI_MAX_CALLS_PER_HOUR: positiveInteger.default(50),
  PLANT_SPECIES_AI_MAX_CALLS_PER_DAY: positiveInteger.default(500),

  PLANT_CONDITION_AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PLANT_CONDITION_AI_MODEL: z.string().min(1).optional(),
  PLANT_CONDITION_AI_CALL_TIMEOUT_MS: positiveInteger.default(10_000),
  PLANT_CONDITION_AI_MAX_OUTPUT_TOKENS: positiveInteger.default(256),
  PLANT_CONDITION_AI_MAX_CALLS_PER_HOUR: positiveInteger.default(50),
  PLANT_CONDITION_AI_MAX_CALLS_PER_DAY: positiveInteger.default(500),

  // P11-ASYNC-01: the taxon-enrichment pipeline's first real structured-
  // assertion provider, USDA PLANTS — the same per-capability, default-off
  // kill-switch posture `PLANT_SPECIES_AI_ENABLED` already established,
  // applied to a source that needs no API key at all. Off (the default,
  // and every environment today): the registry is empty, `sourcePriority`
  // is `[]`, and `RunTaxonEnrichmentSweep` runs as a documented no-op — see
  // `run-taxon-enrichment-sweep.ts`'s own header. Generous timeout and
  // conservative quota defaults reflect `docs/development/plant-knowledge-
  // provider-runbooks.md` section 2.2's own flag: this is an undocumented
  // internal API with no published rate limit, so the defensive posture is
  // deliberate, not a guess at a real published number.
  USDA_PLANTS_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  USDA_PLANTS_CALL_TIMEOUT_MS: positiveInteger.default(15_000),
  USDA_PLANTS_MAX_CALLS_PER_HOUR: positiveInteger.default(120),
  USDA_PLANTS_MAX_CALLS_PER_DAY: positiveInteger.default(1_000),

  // P11-PROV-01: three more taxon-knowledge providers, the identical
  // per-capability default-off kill-switch posture as USDA PLANTS above.
  // Each needs no API key; timeout/quota defaults are generous/conservative
  // for the same "no documented rate limit, treat defensively" reasoning
  // docs/development/plant-knowledge-provider-runbooks.md records for every
  // source in this file.
  GBIF_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  GBIF_CALL_TIMEOUT_MS: positiveInteger.default(15_000),
  GBIF_MAX_CALLS_PER_HOUR: positiveInteger.default(120),
  GBIF_MAX_CALLS_PER_DAY: positiveInteger.default(1_000),

  USA_NPN_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  USA_NPN_CALL_TIMEOUT_MS: positiveInteger.default(15_000),
  USA_NPN_MAX_CALLS_PER_HOUR: positiveInteger.default(60),
  USA_NPN_MAX_CALLS_PER_DAY: positiveInteger.default(500),

  WORLD_FLORA_ONLINE_PROVIDER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  WORLD_FLORA_ONLINE_CALL_TIMEOUT_MS: positiveInteger.default(15_000),
  WORLD_FLORA_ONLINE_MAX_CALLS_PER_HOUR: positiveInteger.default(120),
  WORLD_FLORA_ONLINE_MAX_CALLS_PER_DAY: positiveInteger.default(1_000),

  // P11-PROV-01: the horticultural-review surface's own gate. No
  // platform-wide "reviewer" role exists anywhere in this codebase yet
  // (docs/architecture/identity-and-authorization.md section 13 describes
  // one only as an undesigned aspiration) — a comma-separated verified-email
  // allowlist is the smallest gate that needs no new DB/role infrastructure,
  // reusing `originList`'s own comma-separated-to-array shape and
  // `ActorContext.email`/`emailVerified` (already populated by every
  // authenticated request, for the invitation-email-binding use this field
  // was originally added for). An empty default means "no reviewer
  // configured" — the honest state every environment starts in, matching
  // `WEATHER_ACTIVE_PROVIDER_KEY`'s own "absent means off" posture.
  PLANT_REVIEWER_EMAILS: originList,

  // P9C-INVITE-01: transactional email (Resend, decided 2026-07-26 —
  // section 29.1.1). Absent `RESEND_API_KEY` (every environment today) is
  // the honest `noProviderConfigured`-style degradation
  // `CreateClientInvitation` answers with. `RESEND_FROM_EMAIL`/
  // `CLIENT_PORTAL_BASE_URL` are required TOGETHER with the key
  // (`findTransactionalEmailIssues`, the `findWeatherProviderIssues` shape).
  // 8 s matches `WEATHER_CALL_TIMEOUT_MS`'s own reasoning.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().min(1).optional(),
  CLIENT_PORTAL_BASE_URL: z.string().min(1).optional(),
  RESEND_CALL_TIMEOUT_MS: positiveInteger.default(8_000),

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

// Cross-field validation (`ConfigurationIssue`, `findDatabaseModeIssues`,
// `findAiExplanationIssues`, `findPlantSpeciesAiIssues`,
// `findPlantConditionAiIssues`, `findWeatherProviderIssues`,
// `findTransactionalEmailIssues`) lives in
// `configuration-cross-field-issues.ts` — split out for the 600-line limit.
//
// The per-capability configuration interfaces and `toApplicationConfiguration`
// (the assembly function) live in `configuration-shape.ts` — same reason,
// re-exported here so every existing importer keeps importing from this one
// file unchanged.
export * from './configuration-shape.js';
