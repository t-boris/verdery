/**
 * The four scheduler behaviors P6-RET-01's retention scheduler proved,
 * carried over unchanged to the generalized implementation all three sweeps
 * now share — including the overlap guard that is one layer of the
 * P7-ASYNC-01 duplicate-safety evidence (overlapping firings never start a
 * second concurrent run) — plus the run at start.
 *
 * The interval cases below pass an initial delay LONGER than the span they
 * advance, so they still measure interval firings alone. That is explicit
 * rather than incidental: with the real 15s default they would have kept
 * passing while saying nothing about the start run, which is the behavior
 * most worth pinning here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger.js';
import { silentLogger } from '../relay/relay-test-doubles.js';
import { createIntervalSweepScheduler } from './interval-sweep-scheduler.js';
import type { SweepTrigger } from './sweep-trigger.js';

const EVENTS = {
  failedEvent: 'test.sweep_failed',
  failedMessage: 'Test sweep trigger failed; it will be retried on the next interval',
};

const EMPTY_SUMMARY = { processed: 0 };

/** Longer than any span these interval cases advance, so only interval firings are counted. */
const NO_START_RUN_WITHIN_TEST = 1_000_000;

describe('createIntervalSweepScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the trigger once per interval', async () => {
    let calls = 0;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createIntervalSweepScheduler(
      trigger,
      1_000,
      EVENTS,
      silentLogger(),
      NO_START_RUN_WITHIN_TEST,
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(3_000);
    await scheduler.stop();

    expect(calls).toBe(3);
  });

  it('skips a firing while a previous run is still in flight, rather than overlapping', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve(EMPTY_SUMMARY);
        });
      },
    };
    const scheduler = createIntervalSweepScheduler(
      trigger,
      1_000,
      EVENTS,
      silentLogger(),
      NO_START_RUN_WITHIN_TEST,
    );

    scheduler.start();
    // Three intervals elapse while the first run never resolves.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls).toBe(1);

    release?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);

    release?.();
    await scheduler.stop();
  });

  it('a failed run is logged with the configured event and the next interval retries', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('api unavailable'))
          : Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const logger = {
      ...silentLogger(),
      error: (context: unknown) => {
        errors.push(context);
      },
    } as unknown as Logger;
    const scheduler = createIntervalSweepScheduler(
      trigger,
      1_000,
      EVENTS,
      logger,
      NO_START_RUN_WITHIN_TEST,
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_000);
    await scheduler.stop();

    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ event: 'test.sweep_failed' });
  });

  it('runs once shortly after start, without waiting a whole interval', async () => {
    let calls = 0;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createIntervalSweepScheduler(trigger, 1_000, EVENTS, silentLogger(), 100);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);

    await scheduler.stop();
  });

  it('runs at start even when a whole interval will never elapse before restart', async () => {
    // The defect this behavior exists for: a six-hour sweep in a process
    // that is redeployed every few minutes. Under the old interval-only
    // scheduler this ran zero times, however long the service was up in
    // aggregate.
    const sixHours = 21_600_000;
    let calls = 0;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };

    for (let restart = 0; restart < 3; restart += 1) {
      const scheduler = createIntervalSweepScheduler(
        trigger,
        sixHours,
        EVENTS,
        silentLogger(),
        15_000,
      );
      scheduler.start();
      // Up for four minutes, then redeployed — far short of the interval.
      await vi.advanceTimersByTimeAsync(240_000);
      await scheduler.stop();
    }

    expect(calls).toBe(3);
  });

  it('the interval keeps its own cadence from start, not from when the first run lands', async () => {
    let calls = 0;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createIntervalSweepScheduler(trigger, 1_000, EVENTS, silentLogger(), 100);

    scheduler.start();
    // Start run at 100ms, then interval firings at 1000/2000/3000ms.
    await vi.advanceTimersByTimeAsync(3_000);
    await scheduler.stop();

    expect(calls).toBe(4);
  });

  it('stop() before the start run has fired cancels it', async () => {
    let calls = 0;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createIntervalSweepScheduler(trigger, 1_000, EVENTS, silentLogger(), 5_000);

    scheduler.start();
    // A process that comes up and is torn down inside the settle window
    // must not fire a sweep on its way out.
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toBe(0);
  });

  it('stop() prevents further runs and resolves after any in-flight run finishes', async () => {
    let calls = 0;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createIntervalSweepScheduler(
      trigger,
      1_000,
      EVENTS,
      silentLogger(),
      NO_START_RUN_WITHIN_TEST,
    );

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls).toBe(1);
  });
});
