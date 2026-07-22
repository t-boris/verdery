/**
 * Structured logging.
 *
 * Every log line is JSON carrying service, version, and environment so that a
 * line is interpretable without knowing which deployment emitted it. Redaction
 * happens in the logger itself rather than at the call site, because a rule that
 * depends on every author remembering it is not a rule.
 *
 * Source: architecture/observability-and-analytics.md, sections
 * "5. Structured Logging" and "6. Prohibited Telemetry".
 */

import { pino, type DestinationStream, type Logger } from 'pino';
import type { ApplicationConfiguration } from '../configuration/configuration-schema.js';

export type { Logger };

/**
 * Fields removed before a log record is written.
 *
 * Credentials, cookies, and signed URLs are prohibited telemetry, so they are
 * dropped rather than masked: a masked field still proves the value existed and
 * still risks partial disclosure through length.
 */
const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-firebase-appcheck"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'databaseUrl',
  'password',
  'token',
  'secret',
  'signedUrl',
];

/** Creates the root logger for a service process. */
export function createLogger(
  configuration: ApplicationConfiguration,
  serviceName: string,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: configuration.logLevel,
      base: {
        service: serviceName,
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
