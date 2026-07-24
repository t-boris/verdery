/**
 * Worker configuration.
 *
 * A worker has its own composition root, service identity, configuration, and
 * deployment; it never imports the running API application. Keeping this schema
 * separate from the API's is what makes that separation real rather than
 * aspirational.
 *
 * P6-ASYNC-01 adds the narrow relay database and Cloud Tasks configuration.
 * P6-WORKER-01 adds the inbound validation target and the authenticated API
 * result callback.
 *
 * `DATABASE_URL` only — no `cloudSqlIam` mode, unlike the API. Adding the
 * Cloud SQL connector (`@google-cloud/cloud-sql-connector`) to this package
 * too would be a second new architecturally-significant Google Cloud
 * dependency in the same stage that already justifies `@google-cloud/tasks`
 * (see this stage's own report for that reasoning); real Cloud SQL IAM
 * wiring for the worker's own database connection is left as a documented,
 * explicit follow-up rather than folded in here unasked.
 *
 * Source: architecture/backend-modular-monolith.md, section "19. Worker Boundary";
 *         architecture/asynchronous-processing.md, sections "4. Transactional
 *         Outbox", "5. Cloud Tasks".
 */

import { z } from 'zod';

export type DeploymentEnvironment = 'development' | 'staging' | 'production';

const positiveInteger = z.coerce.number().int().positive();
const durationMilliseconds = z.coerce.number().int().min(0);

export const environmentSchema = z.object({
  VERDERY_ENVIRONMENT: z.enum(['development', 'staging', 'production']),
  SERVICE_VERSION: z.string().min(1).default('0.0.0-development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HTTP_PORT: positiveInteger.default(8080),

  // The relay's own narrow database connection. A plain connection string,
  // not Cloud SQL IAM mode — see this file's own header comment.
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX_CONNECTIONS: positiveInteger.default(5),
  DATABASE_CONNECTION_TIMEOUT_MS: durationMilliseconds.default(5_000),
  DATABASE_STATEMENT_TIMEOUT_MS: durationMilliseconds.default(10_000),

  // How often the relay scans `platform.outbox_event` for unpublished,
  // media-relevant rows, and how many it claims per tick. No number is
  // named anywhere in this repository's docs for either — both are reasoned
  // defaults, documented here the same "no number decided yet, pick one and
  // say so" posture `09-media-storage.sh`'s own export-bucket lifecycle rule
  // already sets. Five seconds keeps outbox publication lag (architecture/
  // asynchronous-processing.md section "18. Observability") low without
  // polling aggressively; twenty rows per tick bounds one tick's own work
  // without leaving a burst of registrations starved.
  RELAY_POLL_INTERVAL_MS: durationMilliseconds.default(5_000),
  RELAY_BATCH_SIZE: positiveInteger.default(20),

  // Cloud Tasks invokes `TASK_URL`; the validation worker posts a structured
  // result to `RESULT_CALLBACK_URL` with an ID token minted for the callback
  // audience. Resource names are explicit and contain no credentials.
  MEDIA_PROCESSING_QUEUE_PROJECT_ID: z.string().min(1),
  MEDIA_PROCESSING_QUEUE_LOCATION: z.string().min(1),
  MEDIA_PROCESSING_QUEUE_NAME: z.string().min(1),
  MEDIA_PROCESSING_TASK_URL: z.string().url(),
  MEDIA_PROCESSING_RESULT_CALLBACK_URL: z.string().url(),
  MEDIA_PROCESSING_RESULT_CALLBACK_AUDIENCE: z.string().min(1),
  MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL: z.string().min(1),
});

export type RawEnvironment = z.infer<typeof environmentSchema>;

export interface WorkerDatabaseConfiguration {
  readonly url: string;
  readonly maxConnections: number;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

export interface RelayConfiguration {
  readonly pollIntervalMs: number;
  readonly batchSize: number;
}

export interface MediaProcessingQueueConfiguration {
  readonly projectId: string;
  readonly location: string;
  readonly queueName: string;
  readonly taskUrl: string;
  readonly resultCallbackUrl: string;
  readonly resultCallbackAudience: string;
  readonly invokerServiceAccountEmail: string;
}

export interface WorkerConfiguration {
  readonly environment: DeploymentEnvironment;
  readonly serviceVersion: string;
  readonly logLevel: RawEnvironment['LOG_LEVEL'];
  readonly httpPort: number;
  readonly database: WorkerDatabaseConfiguration;
  readonly relay: RelayConfiguration;
  readonly mediaProcessing: MediaProcessingQueueConfiguration;
}

/** Raised when the process environment cannot produce a valid configuration. */
export class ConfigurationError extends Error {
  readonly variables: readonly string[];

  constructor(message: string, variables: readonly string[]) {
    super(message);
    this.name = 'ConfigurationError';
    this.variables = variables;
  }
}

function toWorkerConfiguration(raw: RawEnvironment): WorkerConfiguration {
  return {
    environment: raw.VERDERY_ENVIRONMENT,
    serviceVersion: raw.SERVICE_VERSION,
    logLevel: raw.LOG_LEVEL,
    httpPort: raw.HTTP_PORT,
    database: {
      url: raw.DATABASE_URL,
      maxConnections: raw.DATABASE_POOL_MAX_CONNECTIONS,
      connectionTimeoutMs: raw.DATABASE_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    relay: {
      pollIntervalMs: raw.RELAY_POLL_INTERVAL_MS,
      batchSize: raw.RELAY_BATCH_SIZE,
    },
    mediaProcessing: {
      projectId: raw.MEDIA_PROCESSING_QUEUE_PROJECT_ID,
      location: raw.MEDIA_PROCESSING_QUEUE_LOCATION,
      queueName: raw.MEDIA_PROCESSING_QUEUE_NAME,
      taskUrl: raw.MEDIA_PROCESSING_TASK_URL,
      resultCallbackUrl: raw.MEDIA_PROCESSING_RESULT_CALLBACK_URL,
      resultCallbackAudience: raw.MEDIA_PROCESSING_RESULT_CALLBACK_AUDIENCE,
      invokerServiceAccountEmail: raw.MEDIA_PROCESSING_INVOKER_SERVICE_ACCOUNT_EMAIL,
    },
  };
}

/**
 * Validates the process environment and returns typed configuration.
 *
 * @throws ConfigurationError naming every offending variable.
 */
export function loadConfiguration(
  source: Readonly<Record<string, string | undefined>> = process.env,
): WorkerConfiguration {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const variables = result.error.issues.map((issue) => issue.path.map(String).join('.'));
    const details = result.error.issues
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('; ');

    throw new ConfigurationError(`Invalid worker configuration. ${details}`, variables);
  }

  return toWorkerConfiguration(result.data);
}
