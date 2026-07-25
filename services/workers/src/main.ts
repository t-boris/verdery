/**
 * Worker process entry point.
 *
 * Runs both worker-owned entry points: the transactional outbox relay and
 * the authenticated HTTP target that now dispatches (via
 * `MediaProcessingJobRouter`) to either the validator or, new in
 * P6-WORKER-02, the derivative generator.
 *
 * Source: architecture/backend-modular-monolith.md, section "19. Worker Boundary";
 *         docs/implementation-plan.md, work packages P6-ASYNC-01,
 *         P6-WORKER-01, P6-WORKER-02.
 */

import { CloudTasksClient } from '@google-cloud/tasks';
import { Storage } from '@google-cloud/storage';
import { registerGracefulShutdown } from './bootstrap/graceful-shutdown.js';
import { ConfigurationError, loadConfiguration } from './configuration.js';
import { GcsObjectDeleter } from './deletion/gcs-object-deleter.js';
import { ProcessMediaDeletionJob } from './deletion/process-media-deletion-job.js';
import { GcsDerivativeObjectSink } from './derivatives/gcs-derivative-object-sink.js';
import { ProcessMediaDerivativeGenerationJob } from './derivatives/process-media-derivative-generation-job.js';
import { createLogger, SERVICE_NAME } from './logger.js';
import { MediaProcessingJobRouter } from './media-processing-job-router.js';
import { CloudTasksMediaProcessingQueue } from './relay/cloud-tasks-media-processing-queue.js';
import { KyselyOutboxEventStore } from './relay/kysely-outbox-event-store.js';
import { KyselyProcessingJobStore } from './relay/kysely-processing-job-store.js';
import { OutboxRelay } from './relay/outbox-relay.js';
import { createRelayPoller } from './relay/poller.js';
import { createRelayDatabase } from './relay/relay-database.js';
import { createRetentionSweepScheduler } from './retention/retention-sweep-scheduler.js';
import { GoogleApiRetentionSweepTrigger } from './retention/retention-sweep-trigger.js';
import { GcsMediaObjectSource } from './validation/gcs-media-object-source.js';
import { GoogleApiResultRecorder } from './validation/google-api-result-recorder.js';
import { MediaValidator } from './validation/media-validator.js';
import { GoogleOidcInvocationVerifier } from './validation/oidc-invocation-verifier.js';
import { ProcessMediaValidationJob } from './validation/process-media-validation-job.js';
import { UnavailableMalwareScanner } from './validation/validation-result.js';
import { ValidationHttpServer } from './validation/validation-http-server.js';

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
    configuration.mediaProcessing.taskUrl,
    configuration.mediaProcessing.invokerServiceAccountEmail,
  );

  const storage = new Storage();
  // One shared result recorder: both job kinds post their structured result
  // to the SAME authenticated hop-2 callback (`services/api`'s
  // `RecordMediaProcessingResult` branches on `job.jobKind` itself, not on
  // which recorder posted it).
  const resultRecorder = new GoogleApiResultRecorder(
    configuration.mediaProcessing.resultCallbackUrl,
    configuration.mediaProcessing.resultCallbackAudience,
  );
  const jobRouter = new MediaProcessingJobRouter(
    new ProcessMediaValidationJob(
      new MediaValidator(new GcsMediaObjectSource(storage), new UnavailableMalwareScanner()),
      resultRecorder,
    ),
    new ProcessMediaDerivativeGenerationJob(
      new GcsMediaObjectSource(storage),
      new GcsDerivativeObjectSink(storage, configuration.mediaDerivedBucket),
      resultRecorder,
    ),
    // P6-RET-01: prefix-scoped object deletion with absence verification.
    new ProcessMediaDeletionJob(new GcsObjectDeleter(storage), resultRecorder),
  );
  const validationServer = new ValidationHttpServer(
    new GoogleOidcInvocationVerifier(
      configuration.mediaProcessing.taskUrl,
      configuration.mediaProcessing.invokerServiceAccountEmail,
    ),
    jobRouter,
    logger,
  );
  await validationServer.listen(configuration.httpPort);

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

  // P6-RET-01: the retention-sweep interval. The sweep itself runs in
  // services/api; this process only supplies the schedule and its
  // authenticated trigger — see retention/retention-sweep-trigger.ts's own
  // header comment for the privilege-boundary reasoning.
  const retentionSweepScheduler = createRetentionSweepScheduler(
    new GoogleApiRetentionSweepTrigger(
      configuration.retentionSweep.sweepUrl,
      configuration.mediaProcessing.resultCallbackAudience,
      logger,
    ),
    configuration.retentionSweep.intervalMs,
    logger,
  );
  retentionSweepScheduler.start();

  logger.info(
    {
      event: 'service.started',
      service: SERVICE_NAME,
      pollIntervalMs: configuration.relay.pollIntervalMs,
      retentionSweepIntervalMs: configuration.retentionSweep.intervalMs,
      httpPort: configuration.httpPort,
    },
    'Worker started',
  );

  registerGracefulShutdown({
    drain: async () => {
      await poller.stop();
      await retentionSweepScheduler.stop();
      await validationServer.close();
      await relayDatabase.close();
      await cloudTasksClient.close();
    },
    gracePeriodMs: 15_000,
    logger,
    exit: (code) => process.exit(code),
  });
}

await main();
