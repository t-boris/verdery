/**
 * Structured logging for worker processes.
 *
 * Workers emit the same JSON shape as the API so one dashboard and one
 * redaction policy cover both deployment units.
 *
 * Source: architecture/observability-and-analytics.md, sections
 * "5. Structured Logging" and "6. Prohibited Telemetry".
 */

import { pino, type DestinationStream, type Logger } from 'pino';
import type { WorkerConfiguration } from './configuration.js';

export type { Logger };

const REDACTED_PATHS: readonly string[] = [
  'databaseUrl',
  'password',
  'token',
  'secret',
  'signedUrl',
  'manifest.signedUrl',
];

export const SERVICE_NAME = 'verdery-workers';

/** Only the fields `createLogger` actually reads — narrower than the full `WorkerConfiguration` so a test does not need to fabricate database/relay/Cloud Tasks settings just to build a logger. */
export type LoggerConfiguration = Pick<
  WorkerConfiguration,
  'logLevel' | 'serviceVersion' | 'environment'
>;

export function createLogger(
  configuration: LoggerConfiguration,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: configuration.logLevel,
      base: {
        service: SERVICE_NAME,
        version: configuration.serviceVersion,
        environment: configuration.environment,
      },
      redact: { paths: [...REDACTED_PATHS], remove: true },
      formatters: {
        level: (label) => ({ severity: label.toUpperCase(), level: label }),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
