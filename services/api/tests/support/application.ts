/**
 * Test composition of the HTTP application.
 *
 * Tests build the real application with the real plugin chain and substitute
 * only the database, so route, correlation, and error behavior is exercised as
 * deployed.
 *
 * Source: architecture/testing-strategy.md, section "7. API Contract Tests".
 */

import type { FastifyInstance } from 'fastify';
import { buildApplication } from '../../src/app.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { ApplicationConfiguration } from '../../src/platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from '../../src/platform/database/database-gateway.js';
import { createLogger } from '../../src/platform/telemetry/logger.js';
import { SystemClock } from '../../src/shared/time/clock.js';

export const TEST_SERVICE_VERSION = '1.0.0-test';

export const testConfiguration: ApplicationConfiguration = {
  environment: 'development',
  serviceVersion: TEST_SERVICE_VERSION,
  logLevel: 'info',
  http: {
    host: '127.0.0.1',
    port: 0,
    bodyLimitBytes: 1_048_576,
    allowedOrigins: [],
  },
  database: {
    mode: 'url',
    url: 'postgresql://verdery:not-a-real-secret@localhost:5432/verdery',
    maxConnections: 1,
    connectionTimeoutMs: 1_000,
    statementTimeoutMs: 1_000,
  },
  shutdownGracePeriodMs: 1_000,
  firebaseProjectId: 'verdery-test',
};

/** A database that answers health checks according to the supplied behavior. */
export function stubDatabase(ping: () => Promise<void>): DatabaseGateway {
  return {
    queries: {} as DatabaseGateway['queries'],
    ping,
    close: () => Promise.resolve(),
  };
}

/** Rejects every call. Suites that never exercise an authenticated route need nothing more specific. */
export function stubTokenVerifier(): TokenVerifier {
  const notImplemented = (): Promise<never> =>
    Promise.reject(new Error('stubTokenVerifier: no behavior configured for this test'));

  return {
    verifyIdToken: notImplemented,
    verifySessionCookie: notImplemented,
    createSessionCookie: notImplemented,
    revokeRefreshTokens: notImplemented,
  };
}

export interface TestApplicationOptions {
  readonly ping?: () => Promise<void>;
  /** Captures log records so tests can assert on structured output. */
  readonly onLogRecord?: (record: string) => void;
  readonly database?: DatabaseGateway;
  readonly tokenVerifier?: TokenVerifier;
}

export async function buildTestApplication(
  options: TestApplicationOptions = {},
): Promise<FastifyInstance> {
  const logger = createLogger(testConfiguration, 'verdery-api-test', {
    write: (record) => options.onLogRecord?.(record),
  });

  return buildApplication({
    configuration: testConfiguration,
    logger,
    database: options.database ?? stubDatabase(options.ping ?? (() => Promise.resolve())),
    tokenVerifier: options.tokenVerifier ?? stubTokenVerifier(),
    clock: new SystemClock(),
  });
}
