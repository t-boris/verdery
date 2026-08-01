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
import { FakeMediaStorageGateway } from '../../src/modules/media/application/media-test-doubles.js';
import type { MediaStorageGateway } from '../../src/modules/media/public.js';
import { FakePushMessageSender } from '../../src/modules/notifications/application/notification-test-doubles.js';
import type { PushMessageSender } from '../../src/modules/notifications/public.js';
import type { AppCheckVerifier } from '../../src/platform/app-check/app-check-verifier.js';
import { FakeIdentityProviderAccountGateway } from '../../src/platform/authentication/identity-provider-account-test-double.js';
import type { IdentityProviderAccountGateway } from '../../src/platform/authentication/identity-provider-account-gateway.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { ApplicationConfiguration } from '../../src/platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from '../../src/platform/database/database-gateway.js';
import type { CloudTasksInvocationVerifier } from '../../src/platform/tasks/cloud-tasks-invocation-verifier.js';
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
  media: {
    buckets: {
      userMedia: 'test-user-media',
      rawCapture: 'test-raw-capture',
      derived: 'test-derived',
      exports: 'test-exports',
    },
    uploadSessionTtlMs: 3_600_000,
    signedDownloadTtlMs: 900_000,
    processingCallback: {
      audience: 'https://verdery-api-test.example/v1/internal/media-processing-jobs',
      invokerServiceAccountEmail: 'verdery-worker-test@verdery-test.iam.gserviceaccount.com',
    },
  },
  // P7-ASYNC-01 / P0-PROV-01: the Open-Meteo adapter IS registered by the
  // composition root, but no provider is SELECTED here, so every test-built
  // application runs with the honest `noProviderConfigured` reality and
  // never reaches the network. The numbers and the keyless free tier are the
  // schema's own documented defaults.
  weather: {
    activeProviderKey: null,
    observationFreshForMs: 3_600_000,
    forecastFreshForMs: 21_600_000,
    callTimeoutMs: 8_000,
    maxCallsPerHour: 300,
    maxCallsPerDay: 3_000,
    openMeteo: { tier: 'free', apiKey: null, pastDays: 7, forecastDays: 7 },
  },
  // P7-AI-01: the kill-switch off — every test-built application runs the
  // pure deterministic explanation path, like every real environment
  // today; the numbers are the schema's own documented defaults.
  aiExplanation: {
    enabled: false,
    vertexProjectId: null,
    vertexLocation: 'us-central1',
    model: null,
    callTimeoutMs: 10_000,
    maxOutputTokens: 512,
    maxCallsPerHour: 50,
    maxCallsPerDay: 500,
  },
  // ADR-0015: both kill-switches off — every test-built application runs
  // the honest `noProviderConfigured` degradation for plant identification
  // and condition tracking, like every real environment today; the numbers
  // are the schema's own documented defaults.
  plantSpeciesAi: {
    enabled: false,
    model: null,
    callTimeoutMs: 10_000,
    maxOutputTokens: 256,
    maxCallsPerHour: 50,
    maxCallsPerDay: 500,
  },
  plantConditionAi: {
    enabled: false,
    model: null,
    callTimeoutMs: 10_000,
    maxOutputTokens: 256,
    maxCallsPerHour: 50,
    maxCallsPerDay: 500,
  },
  // P11-ASYNC-01: the kill-switch off — every test-built application runs
  // with an empty assertion-provider registry and a no-op enrichment sweep,
  // like every real environment today; the numbers are the schema's own
  // documented defaults.
  taxonKnowledge: {
    usdaPlants: {
      enabled: false,
      callTimeoutMs: 15_000,
      maxCallsPerHour: 120,
      maxCallsPerDay: 1_000,
    },
    gbif: {
      enabled: false,
      callTimeoutMs: 15_000,
      maxCallsPerHour: 120,
      maxCallsPerDay: 1_000,
    },
    usaNpn: {
      enabled: false,
      callTimeoutMs: 15_000,
      maxCallsPerHour: 60,
      maxCallsPerDay: 500,
    },
    worldFloraOnline: {
      enabled: false,
      callTimeoutMs: 15_000,
      maxCallsPerHour: 120,
      maxCallsPerDay: 1_000,
    },
  },
  // P8-SEC-02: the enforcement switch in its default position, like every
  // real environment today. This is load-bearing for the whole suite: it is
  // why 1,500-odd existing tests, most of which send no App Check header at
  // all, keep exercising exactly the pipeline they were written against.
  // `buildTestApplication({ configuration: ... })` is how the enforce
  // position is tested, and only the tests that mean to test it get it.
  appCheck: {
    enforcement: 'monitor',
  },
  // P9C-INVITE-01: no Resend account is provisioned for the test suite,
  // like every real environment today — every test-built application runs
  // with the honest `null`-adapter degradation `CreateClientInvitation`
  // answers with, never a real network call.
  transactionalEmail: {
    apiKey: null,
    fromEmail: null,
    clientPortalBaseUrl: null,
    callTimeoutMs: 8_000,
  },
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

/** Classifies every token as `'missing'`. Suites that don't test App Check monitoring need nothing more specific. */
export function stubAppCheckVerifier(): AppCheckVerifier {
  return {
    classify: () => Promise.resolve('missing'),
  };
}

/** Never touches real Cloud Storage. Suites that don't exercise the media routes need nothing more specific than this default instance. */
export function stubMediaStorageGateway(): MediaStorageGateway {
  return new FakeMediaStorageGateway();
}

/** Rejects every call. Suites that don't exercise the media-processing callback route need nothing more specific. */
export function stubCloudTasksInvocationVerifier(): CloudTasksInvocationVerifier {
  return {
    verify: () =>
      Promise.reject(
        new Error('stubCloudTasksInvocationVerifier: no behavior configured for this test'),
      ),
  };
}

/**
 * Never touches Firebase Authentication (P8-DELETE-01). Every test-built
 * application gets this, so no test can delete a real identity — the same
 * structural guarantee `stubMediaStorageGateway` gives for Cloud Storage.
 */
export function stubIdentityProviderAccountGateway(): FakeIdentityProviderAccountGateway {
  return new FakeIdentityProviderAccountGateway();
}

/** Never touches FCM (P7-NOTIF-02). Suites that don't exercise the delivery sweep need nothing more specific than this accepting fake. */
export function stubPushMessageSender(): PushMessageSender {
  return new FakePushMessageSender();
}

export interface TestApplicationOptions {
  readonly ping?: () => Promise<void>;
  /** Captures log records so tests can assert on structured output. */
  readonly onLogRecord?: (record: string) => void;
  readonly database?: DatabaseGateway;
  readonly tokenVerifier?: TokenVerifier;
  readonly appCheckVerifier?: AppCheckVerifier;
  readonly mediaStorageGateway?: MediaStorageGateway;
  readonly cloudTasksInvocationVerifier?: CloudTasksInvocationVerifier;
  readonly pushMessageSender?: PushMessageSender;
  readonly identityProviderAccounts?: IdentityProviderAccountGateway;
  /**
   * Overrides `testConfiguration` wholesale. Added for P8-SEC-02, whose whole
   * point is that both positions of the App Check enforcement switch are
   * proven — which needs an application built with `enforcement: 'enforce'`
   * while every other suite keeps the default.
   */
  readonly configuration?: ApplicationConfiguration;
}

export async function buildTestApplication(
  options: TestApplicationOptions = {},
): Promise<FastifyInstance> {
  const configuration = options.configuration ?? testConfiguration;
  const logger = createLogger(configuration, 'verdery-api-test', {
    write: (record) => options.onLogRecord?.(record),
  });

  return buildApplication({
    configuration,
    logger,
    database: options.database ?? stubDatabase(options.ping ?? (() => Promise.resolve())),
    tokenVerifier: options.tokenVerifier ?? stubTokenVerifier(),
    appCheckVerifier: options.appCheckVerifier ?? stubAppCheckVerifier(),
    clock: new SystemClock(),
    mediaStorageGateway: options.mediaStorageGateway ?? stubMediaStorageGateway(),
    cloudTasksInvocationVerifier:
      options.cloudTasksInvocationVerifier ?? stubCloudTasksInvocationVerifier(),
    // P7-AI-01 / ADR-0015: `null` exactly as main.ts passes with each
    // kill-switch off.
    aiExplanationAdapter: null,
    plantSpeciesIdentificationAdapter: null,
    plantConditionAnalysisAdapter: null,
    pushMessageSender: options.pushMessageSender ?? stubPushMessageSender(),
    identityProviderAccounts:
      options.identityProviderAccounts ?? stubIdentityProviderAccountGateway(),
  });
}
