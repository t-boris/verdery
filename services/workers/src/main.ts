/**
 * Worker process entry point.
 *
 * Phase 1 delivered the deployment unit only: configuration, logging, and
 * lifecycle. P6-ASYNC-01 is the first real job registered here: the
 * transactional-outbox relay for media-processing jobs, driven on a plain
 * interval — see `relay/outbox-relay.ts`'s own header comment for why it
 * lives in this package and how it behaves.
 *
 * Source: architecture/backend-modular-monolith.md, section "19. Worker Boundary";
 *         docs/implementation-plan.md, work package P6-ASYNC-01.
 */

import { CloudTasksClient } from '@google-cloud/tasks';
import { registerGracefulShutdown } from './bootstrap/graceful-shutdown.js';
import { ConfigurationError, loadConfiguration } from './configuration.js';
import { createLogger, SERVICE_NAME } from './logger.js';
import { CloudTasksMediaProcessingQueue } from './relay/cloud-tasks-media-processing-queue.js';
import { KyselyOutboxEventStore } from './relay/kysely-outbox-event-store.js';
import { KyselyProcessingJobStore } from './relay/kysely-processing-job-store.js';
import { OutboxRelay } from './relay/outbox-relay.js';
import { createRelayPoller } from './relay/poller.js';
import { createRelayDatabase } from './relay/relay-database.js';

async function main(): Promise<void> {
  // Configuration failures happen before a logger exists, so they go to stderr.
  const configuration = (() => {
    try {
      return loadConfiguration();
    } catch (error) {
      const message = error instanceof ConfigurationError ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exit(1);
    }
  })();

  const logger = createLogger(configuration);

  const relayDatabase = createRelayDatabase(configuration.database);
  try {
    await relayDatabase.ping();
  } catch (error) {
    logger.error(
      { err: error, event: 'startup.database_unavailable' },
      'The database is unavailable; refusing to start',
    );
    process.exit(1);
  }

  // Application Default Credentials only — this service's own runtime
  // identity in Cloud Run, or a developer's `gcloud auth application-default
  // login` locally — matching every other Google Cloud client in this
  // monorepo (see services/api/src/main.ts's own comment on this posture).
  const cloudTasksClient = new CloudTasksClient();
  const queuePath = cloudTasksClient.queuePath(
    configuration.mediaProcessing.projectId,
    configuration.mediaProcessing.location,
    configuration.mediaProcessing.queueName,
  );
  const mediaProcessingQueue = new CloudTasksMediaProcessingQueue(
    cloudTasksClient,
    queuePath,
    configuration.mediaProcessing.callbackUrl,
    configuration.mediaProcessing.invokerServiceAccountEmail,
  );

  const relay = new OutboxRelay({
    outboxEvents: new KyselyOutboxEventStore(relayDatabase.db),
    processingJobs: new KyselyProcessingJobStore(relayDatabase.db),
    mediaProcessingQueue,
    clock: { now: () => new Date() },
    logger,
    batchSize: configuration.relay.batchSize,
  });

  const poller = createRelayPoller(relay, configuration.relay.pollIntervalMs, logger);
  poller.start();

  logger.info(
    {
      event: 'service.started',
      service: SERVICE_NAME,
      pollIntervalMs: configuration.relay.pollIntervalMs,
    },
    'Worker started',
  );

  registerGracefulShutdown({
    drain: async () => {
      await poller.stop();
      await relayDatabase.close();
      await cloudTasksClient.close();
    },
    gracePeriodMs: 15_000,
    logger,
    exit: (code) => process.exit(code),
  });
}

await main();
