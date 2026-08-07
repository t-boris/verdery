/**
 * Runs a sweep trigger shortly after start and then on a fixed interval —
 * the overlap-guarded interval shape `relay/poller.ts` established (one
 * in-flight run at a time; a firing that would overlap is skipped; `stop()`
 * resolves only once any in-flight run finishes), generalized over WHICH
 * sweep it runs.
 *
 * See `SWEEP_INITIAL_RUN_DELAY_MS` for why the run at start exists and why
 * it is not immediate.
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

/**
 * How long after `start()` the first run fires.
 *
 * WHY A FIRST RUN EXISTS AT ALL. `setInterval` alone means a sweep's first
 * run is one whole interval after the process starts, and every restart
 * resets that clock. This process restarts on every deployment, so any
 * sweep whose interval exceeds the gap between deployments never runs —
 * not rarely, never. That was observed, not theorized: the six-hourly
 * taxon-enrichment sweep executed zero times across a day with twelve
 * worker restarts, which also silently withheld the seasonal-timing
 * proposal phase that runs inside it.
 *
 * WHY NOT ZERO. The process has just come up and is still establishing its
 * own listener; firing six sweep triggers into that moment competes with
 * startup for no benefit, since a sweep that begins seconds later is
 * indistinguishable to a gardener. A short settle also keeps the first
 * triggers clear of the tail of a rollout, where the API can still answer
 * 503 — which matters far more for the first run than for a later one,
 * because for a six-hour sweep "retried on the next interval" means six
 * hours away.
 *
 * It is deliberately one shared constant rather than a per-sweep stagger:
 * six requests arriving together is nothing for the API, and a stagger
 * would be six numbers to keep plausible in exchange for no measurable
 * difference.
 */
export const SWEEP_INITIAL_RUN_DELAY_MS = 15_000;

export function createIntervalSweepScheduler(
  trigger: SweepTrigger<object>,
  intervalMs: number,
  events: SweepFailureLogEvents,
  logger: Logger,
  /** Overridable so tests can drive the first run without advancing fake timers by the real settle. */
  initialRunDelayMs: number = SWEEP_INITIAL_RUN_DELAY_MS,
): SweepScheduler {
  let timer: NodeJS.Timeout | undefined;
  let initialTimer: NodeJS.Timeout | undefined;
  let running = false;
  let inFlight: Promise<void> = Promise.resolve();
  let stopped = false;

  async function runOnce(): Promise<void> {
    // `stopped` is checked here, not only in `stop()`: a firing already
    // queued on the event loop when `stop()` clears the timers would
    // otherwise still start a run the caller has asked to end.
    if (running || stopped) {
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
      // The settle run and the interval are armed together, so the interval
      // keeps its own cadence from `start()` rather than from whenever the
      // first run happens to finish.
      initialTimer = setTimeout(() => {
        initialTimer = undefined;
        void runOnce();
      }, initialRunDelayMs);
      timer = setInterval(() => {
        void runOnce();
      }, intervalMs);
    },
    async stop(): Promise<void> {
      stopped = true;
      if (initialTimer !== undefined) {
        clearTimeout(initialTimer);
        initialTimer = undefined;
      }
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      await inFlight;
    },
  };
}
