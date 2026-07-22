/**
 * Startup configuration loading.
 *
 * Startup fails on the first invalid required value rather than degrading at
 * runtime, and the failure names every offending variable so an operator can
 * fix the deployment without reading service source.
 *
 * Source: architecture/backend-modular-monolith.md, section "10. Configuration".
 */

import type { z } from 'zod';
import type { ApplicationConfiguration, ConfigurationIssue } from './configuration-schema.js';
import {
  environmentSchema,
  findDatabaseModeIssues,
  SECRET_VARIABLES,
  toApplicationConfiguration,
} from './configuration-schema.js';

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
 * Renders one validation issue.
 *
 * Secret variables report only the variable name: a validator message for a
 * malformed connection string can otherwise quote the offending value.
 */
function describeIssue(issue: z.core.$ZodIssue): string {
  const variable = issue.path.map(String).join('.');

  if (SECRET_VARIABLES.has(variable)) {
    return `${variable}: invalid value (redacted)`;
  }

  return `${variable}: ${issue.message}`;
}

function describeConfigurationIssue(issue: ConfigurationIssue): string {
  if (SECRET_VARIABLES.has(issue.variable)) {
    return `${issue.variable}: invalid value (redacted)`;
  }

  return `${issue.variable}: ${issue.message}`;
}

/**
 * Validates the process environment and returns typed configuration.
 *
 * Combines zod's per-field validation with {@link findDatabaseModeIssues},
 * which checks a cross-field rule zod cannot express as a per-field schema.
 * Both run unconditionally and their results are merged, so a deployment with
 * several unrelated problems is told about all of them at once rather than
 * one at a time across repeated restarts.
 *
 * @throws ConfigurationError when any required variable is missing or invalid.
 */
export function loadConfiguration(
  source: Readonly<Record<string, string | undefined>> = process.env,
): ApplicationConfiguration {
  const result = environmentSchema.safeParse(source);
  const modeIssues = findDatabaseModeIssues(source);

  if (!result.success || modeIssues.length > 0) {
    const zodVariables = result.success
      ? []
      : result.error.issues.map((issue) => issue.path.map(String).join('.'));
    const zodDetails = result.success ? [] : result.error.issues.map(describeIssue);

    const modeVariables = modeIssues.map((issue) => issue.variable);
    const modeDetails = modeIssues.map(describeConfigurationIssue);

    const details = [...zodDetails, ...modeDetails].join('; ');

    throw new ConfigurationError(`Invalid service configuration. ${details}`, [
      ...zodVariables,
      ...modeVariables,
    ]);
  }

  return toApplicationConfiguration(result.data);
}
