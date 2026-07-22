/**
 * Worker configuration.
 *
 * A worker has its own composition root, service identity, configuration, and
 * deployment; it never imports the running API application. Keeping this schema
 * separate from the API's is what makes that separation real rather than
 * aspirational.
 *
 * Source: architecture/backend-modular-monolith.md, section "19. Worker Boundary".
 */

import { z } from 'zod';

export type DeploymentEnvironment = 'development' | 'staging' | 'production';

export const environmentSchema = z.object({
  VERDERY_ENVIRONMENT: z.enum(['development', 'staging', 'production']),
  SERVICE_VERSION: z.string().min(1).default('0.0.0-development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export interface WorkerConfiguration {
  readonly environment: DeploymentEnvironment;
  readonly serviceVersion: string;
  readonly logLevel: z.infer<typeof environmentSchema>['LOG_LEVEL'];
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

  return {
    environment: result.data.VERDERY_ENVIRONMENT,
    serviceVersion: result.data.SERVICE_VERSION,
    logLevel: result.data.LOG_LEVEL,
  };
}
