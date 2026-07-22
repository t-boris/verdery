/**
 * Graceful shutdown.
 *
 * Cloud Run sends `SIGTERM` and then waits a bounded grace period. Shutdown
 * must stop accepting requests, let in-flight work finish, and close the
 * connection pool inside that window, because a pool left open holds Cloud SQL
 * connections that the replacement instance needs.
 *
 * Source: architecture/backend-modular-monolith.md, section "20. Health and Lifecycle".
 */

import type { Logger } from '../platform/telemetry/logger.js';

export type ShutdownOutcome = 'completed' | 'timedOut';

/** Signals that mean "stop serving". */
const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Runs the shutdown sequence under a deadline.
 *
 * A drain that outlives the grace period is reported rather than awaited
 * forever: the platform kills the process at the deadline regardless.
 */
export async function shutdownWithTimeout(
  drain: () => Promise<void>,
  gracePeriodMs: number,
): Promise<ShutdownOutcome> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<ShutdownOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve('timedOut');
    }, gracePeriodMs);
  });

  try {
    return await Promise.race([drain().then((): ShutdownOutcome => 'completed'), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export interface GracefulShutdownOptions {
  readonly drain: () => Promise<void>;
  readonly gracePeriodMs: number;
  readonly logger: Logger;
  readonly exit: (code: number) => void;
}

/** Installs signal handlers that drain the process exactly once. */
export function registerGracefulShutdown(options: GracefulShutdownOptions): void {
  let shuttingDown = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;

      options.logger.info({ event: 'service.shutdown_started', signal }, 'Shutting down');

      void shutdownWithTimeout(options.drain, options.gracePeriodMs)
        .then((outcome) => {
          if (outcome === 'timedOut') {
            options.logger.error(
              { event: 'service.shutdown_timed_out', signal },
              'Shutdown exceeded the grace period',
            );
            options.exit(1);
            return;
          }

          options.logger.info({ event: 'service.shutdown_completed', signal }, 'Shutdown complete');
          options.exit(0);
        })
        .catch((error: unknown) => {
          options.logger.error(
            { err: error, event: 'service.shutdown_failed', signal },
            'Shutdown failed',
          );
          options.exit(1);
        });
    });
  }
}
