/**
 * Process entry point.
 *
 * Configuration is validated, telemetry starts, clients are created, the
 * application is composed, and only then does the process accept traffic.
 *
 * Source: architecture/backend-modular-monolith.md, section "9. Composition Root".
 */

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { buildApplication } from './app.js';
import { registerGracefulShutdown } from './bootstrap/graceful-shutdown.js';
import { FirebaseAppCheckVerifier } from './platform/app-check/firebase-app-check-verifier.js';
import { FirebaseTokenVerifier } from './platform/authentication/firebase-token-verifier.js';
import {
  ConfigurationError,
  loadConfiguration,
} from './platform/configuration/load-configuration.js';
import { PostgresDatabaseGateway } from './platform/database/postgres-database-gateway.js';
import { createLogger } from './platform/telemetry/logger.js';
import { SystemClock } from './shared/time/clock.js';

export const SERVICE_NAME = 'verdery-api';

async function main(): Promise<void> {
  // Configuration failures happen before a logger exists, so they are written
  // to stderr directly. The message names the variables, never their values.
  const configuration = (() => {
    try {
      return loadConfiguration();
    } catch (error) {
      const message = error instanceof ConfigurationError ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
  })();

  const logger = createLogger(configuration, SERVICE_NAME);

  let database: PostgresDatabaseGateway;
  try {
    database = await PostgresDatabaseGateway.create(
      configuration.database,
      SERVICE_NAME,
      (error) => {
        logger.error(
          { err: error, event: 'database.idle_connection_failed' },
          'An idle database connection failed; the pool will reconnect on demand',
        );
      },
    );
    await database.ping();
  } catch (error) {
    logger.error(
      { err: error, event: 'startup.database_unavailable' },
      'The database is unavailable; refusing to start',
    );
    process.exit(1);
  }

  // Application Default Credentials: the runtime service account's own
  // identity in Cloud Run, or a developer's `gcloud auth application-default
  // login` locally — no downloaded service account key, matching every other
  // Google Cloud client this service constructs.
  const firebaseApp = initializeApp({
    credential: applicationDefault(),
    projectId: configuration.firebaseProjectId,
  });
  const tokenVerifier = new FirebaseTokenVerifier(firebaseApp);
  const appCheckVerifier = new FirebaseAppCheckVerifier(firebaseApp);
  const clock = new SystemClock();

  const app = await buildApplication({
    configuration,
    logger,
    database,
    tokenVerifier,
    appCheckVerifier,
    clock,
  });

  registerGracefulShutdown({
    drain: async () => {
      // Fastify stops accepting connections and waits for in-flight requests
      // before the pool is closed, so no owned transaction is abandoned.
      await app.close();
      await database.close();
    },
    gracePeriodMs: configuration.shutdownGracePeriodMs,
    logger,
    exit: (code) => process.exit(code),
  });

  await app.listen({ host: configuration.http.host, port: configuration.http.port });
}

await main();
