/**
 * Worker process entry point.
 *
 * Phase 1 delivers the deployment unit only: configuration, logging, and
 * lifecycle. Media verification, derivative generation, and scheduled
 * processing are registered here as they are implemented.
 *
 * Source: architecture/backend-modular-monolith.md, section "19. Worker Boundary";
 *         docs/implementation-plan.md, section "10. Phase 1".
 */

import { ConfigurationError, loadConfiguration } from './configuration.js';
import { createLogger, SERVICE_NAME } from './logger.js';

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

function main(): void {
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

  logger.info({ event: 'service.started', service: SERVICE_NAME }, 'Worker started');

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      logger.info({ event: 'service.shutdown_completed', signal }, 'Worker stopped');
      process.exit(0);
    });
  }
}

main();
