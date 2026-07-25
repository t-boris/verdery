/**
 * Runs the retention-sweep trigger on a fixed interval (P6-RET-01) — the
 * same overlap-guarded interval shape `relay/poller.ts` established (one
 * in-flight run at a time; a firing that would overlap is skipped; `stop()`
 * resolves only once any in-flight run finishes), applied to a different
 * unit of work. Kept as its own small file rather than generalizing
 * `createRelayPoller` over both: the two loops log different result shapes
 * and the guard logic is ~30 lines — a premature abstraction would cost
 * more than this duplication, and `poller.ts`'s own header comment stays
 * accurate about exactly what it runs.
 */

import type { Logger } from '../logger.js';
import type { RetentionSweepTrigger } from './retention-sweep-trigger.js';

export interface RetentionSweepScheduler {
  start(): void;
  /** Stops scheduling new runs and resolves once any in-flight run finishes. */
  stop(): Promise<void>;
}

export function createRetentionSweepScheduler(
  trigger: RetentionSweepTrigger,
  intervalMs: number,
  logger: Logger,
): RetentionSweepScheduler {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let inFlight: Promise<void> = Promise.resolve();
  let stopped = false;

  async function runOnce(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    inFlight = (async () => {
      try {
        await trigger.trigger();
      } catch (error) {
        // A failed sweep is retried on the next interval — the candidates
        // are durable rows, so nothing is lost, only delayed.
        logger.error(
          { err: error, event: 'retention.sweep_failed' },
          'Retention sweep trigger failed; it will be retried on the next interval',
        );
      } finally {
        running = false;
      }
    })();
    await inFlight;
  }

  return {
    start(): void {
      if (timer !== undefined || stopped) {
        return;
      }
      timer = setInterval(() => {
        void runOnce();
      }, intervalMs);
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await inFlight;
    },
  };
}
