/**
 * Runs a sweep trigger on a fixed interval — the overlap-guarded interval
 * shape `relay/poller.ts` established (one in-flight run at a time; a
 * firing that would overlap is skipped; `stop()` resolves only once any
 * in-flight run finishes), generalized over WHICH sweep it runs.
 *
 * P6-RET-01's retention scheduler deliberately duplicated the ~30-line
 * guard rather than generalizing it for two loops, and its own header said
 * so; with P7-ASYNC-01's weather-refresh and recommendation-evaluation
 * sweeps that judgment flips — four near-identical loops would drift, so
 * the three SWEEP loops share this one implementation, parameterized by the
 * failure log event. `poller.ts` stays its own file: it logs per-tick
 * result shapes and skips idle ticks, behavior no sweep wants, and its own
 * header comment stays accurate about exactly what it runs.
 */

import type { Logger } from '../logger.js';
import type { SweepTrigger } from './sweep-trigger.js';

export interface SweepScheduler {
  start(): void;
  /** Stops scheduling new runs and resolves once any in-flight run finishes. */
  stop(): Promise<void>;
}

export interface SweepFailureLogEvents {
  /** The structured `event` value logged when a run throws, e.g. `'retention.sweep_failed'`. */
  readonly failedEvent: string;
  /** The human-readable message accompanying it. */
  readonly failedMessage: string;
}

export function createIntervalSweepScheduler(
  trigger: SweepTrigger<object>,
  intervalMs: number,
  events: SweepFailureLogEvents,
  logger: Logger,
): SweepScheduler {
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
        // A failed sweep is retried on the next interval — every sweep's
        // candidates are durable rows, so nothing is lost, only delayed.
        logger.error({ err: error, event: events.failedEvent }, events.failedMessage);
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
