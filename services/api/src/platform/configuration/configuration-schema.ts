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
export const SECRET_VARIABLES: ReadonlySet<string> = new Set(['DATABASE_URL']);

const positiveInteger = z.coerce.number().int().positive();

const durationMilliseconds = z.coerce.number().int().min(0);

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

export interface ApplicationConfiguration {
  readonly environment: DeploymentEnvironment;
  readonly serviceVersion: string;
  readonly logLevel: RawEnvironment['LOG_LEVEL'];
  readonly http: HttpConfiguration;
  readonly database: DatabaseConfiguration;
  readonly shutdownGracePeriodMs: number;
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
  };
}
