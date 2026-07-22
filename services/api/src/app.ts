/**
 * Composition root.
 *
 * Every plugin, adapter, and route is wired here by hand. There is no
 * auto-loading and no runtime service lookup: what the service contains is
 * readable in one file, and a module cannot acquire a dependency that was not
 * handed to it.
 *
 * Source: architecture/backend-modular-monolith.md, section "9. Composition Root".
 */

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import { API_BASE_PATH } from '@verdery/api-contracts';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  DatabaseDependencyProbe,
  registerHealthRoutes,
  ServiceHealth,
} from './modules/service-health/public.js';
import type { ApplicationConfiguration } from './platform/configuration/configuration-schema.js';
import type { DatabaseGateway } from './platform/database/database-gateway.js';
import { registerErrorHandling } from './platform/errors/error-handler.js';
import { generateRequestId, registerCorrelation } from './platform/telemetry/correlation.js';

/**
 * Everything the HTTP application needs, constructed before it is built.
 *
 * The logger is typed as Fastify's own interface rather than as a pino instance
 * so that request-scoped child loggers stay assignable throughout the pipeline.
 */
export interface ApplicationDependencies {
  readonly configuration: ApplicationConfiguration;
  readonly logger: FastifyBaseLogger;
  readonly database: DatabaseGateway;
}

/**
 * Event-loop delay above which the instance rejects new work.
 *
 * Shedding load early keeps latency bounded for requests already in flight
 * instead of degrading every request equally.
 */
const MAX_EVENT_LOOP_DELAY_MS = 1_000;

export async function buildApplication(
  dependencies: ApplicationDependencies,
): Promise<FastifyInstance> {
  const { configuration, logger, database } = dependencies;

  const app = Fastify({
    loggerInstance: logger,
    genReqId: generateRequestId,
    bodyLimit: configuration.http.bodyLimitBytes,
    // The load balancer terminates TLS and sets the forwarding headers; without
    // this the service logs and rate-limits against the proxy address.
    trustProxy: true,
  });

  registerCorrelation(app);
  registerErrorHandling(app);

  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin:
      configuration.http.allowedOrigins.length === 0
        ? false
        : [...configuration.http.allowedOrigins],
    credentials: true,
  });

  await app.register(underPressure, {
    maxEventLoopDelay: MAX_EVENT_LOOP_DELAY_MS,
    // Health endpoints are owned by the service-health module so that they match
    // the contract document exactly.
    exposeStatusRoute: false,
  });

  const health = new ServiceHealth(
    [new DatabaseDependencyProbe(database)],
    configuration.serviceVersion,
  );

  await app.register(
    (instance, _options, done) => {
      registerHealthRoutes(instance, health);
      done();
    },
    { prefix: API_BASE_PATH },
  );

  return app;
}
