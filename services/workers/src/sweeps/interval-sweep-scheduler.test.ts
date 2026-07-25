/**
 * The four scheduler behaviors P6-RET-01's retention scheduler proved,
 * carried over unchanged to the generalized implementation all three sweeps
 * now share — including the overlap guard that is one layer of the
 * P7-ASYNC-01 duplicate-safety evidence (overlapping firings never start a
 * second concurrent run).
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
    const scheduler = createIntervalSweepScheduler(trigger, 1_000, EVENTS, silentLogger());

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
    const scheduler = createIntervalSweepScheduler(trigger, 1_000, EVENTS, silentLogger());

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
    const scheduler = createIntervalSweepScheduler(trigger, 1_000, EVENTS, logger);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_000);
    await scheduler.stop();

    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ event: 'test.sweep_failed' });
  });

  it('stop() prevents further runs and resolves after any in-flight run finishes', async () => {
    let calls = 0;
    const trigger: SweepTrigger<object> = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createIntervalSweepScheduler(trigger, 1_000, EVENTS, silentLogger());

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls).toBe(1);
  });
});
