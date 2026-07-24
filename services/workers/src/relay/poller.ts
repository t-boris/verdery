/**
 * Runs `OutboxRelay.tick()` on a fixed interval.
 *
 * Guards against overlapping ticks: if one tick is still running when the
 * next interval fires, that firing is skipped rather than starting a second
 * concurrent tick — a slow tick (a large batch, a slow Cloud Tasks call)
 * should not pile up concurrent scans of the same table.
 *
 * Source: implementation-plan.md work package P6-ASYNC-01.
 */

import type { Logger } from '../logger.js';
import type { OutboxRelay, RelayTickResult } from './outbox-relay.js';

export interface RelayPoller {
  start(): void;
  /** Stops scheduling new ticks and resolves once any in-flight tick finishes. */
  stop(): Promise<void>;
}

export function createRelayPoller(
  relay: OutboxRelay,
  intervalMs: number,
  logger: Logger,
): RelayPoller {
  let timer: NodeJS.Timeout | undefined;
  let ticking = false;
  let inFlight: Promise<void> = Promise.resolve();
  let stopped = false;

  function logResult(result: RelayTickResult): void {
    if (result.claimed > 0) {
      logger.info({ event: 'relay.tick_completed', ...result }, 'Relay tick completed');
    }
  }

  async function runTick(): Promise<void> {
    if (ticking) {
      return;
    }
    ticking = true;
    inFlight = (async () => {
      try {
        const result = await relay.tick();
        logResult(result);
      } catch (error) {
        logger.error({ err: error, event: 'relay.tick_failed' }, 'Relay tick threw unexpectedly');
      } finally {
        ticking = false;
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
        void runTick();
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
