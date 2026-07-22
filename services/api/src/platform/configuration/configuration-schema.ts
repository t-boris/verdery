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

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX_CONNECTIONS: positiveInteger.default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: durationMilliseconds.default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: durationMilliseconds.default(10_000),

  SHUTDOWN_GRACE_PERIOD_MS: durationMilliseconds.default(15_000),
});

export type RawEnvironment = z.infer<typeof environmentSchema>;

export interface HttpConfiguration {
  readonly host: string;
  readonly port: number;
  readonly bodyLimitBytes: number;
  readonly allowedOrigins: readonly string[];
}

export interface DatabaseConfiguration {
  /** Connection string. Treated as a secret and never logged. */
  readonly url: string;
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

export interface ApplicationConfiguration {
  readonly environment: DeploymentEnvironment;
  readonly serviceVersion: string;
  readonly logLevel: RawEnvironment['LOG_LEVEL'];
  readonly http: HttpConfiguration;
  readonly database: DatabaseConfiguration;
  readonly shutdownGracePeriodMs: number;
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
    database: {
      url: raw.DATABASE_URL,
      maxConnections: raw.DATABASE_POOL_MAX_CONNECTIONS,
      connectionTimeoutMs: raw.DATABASE_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    shutdownGracePeriodMs: raw.SHUTDOWN_GRACE_PERIOD_MS,
  };
}
