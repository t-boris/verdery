import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger.js';
import { silentLogger } from '../relay/relay-test-doubles.js';
import { createRetentionSweepScheduler } from './retention-sweep-scheduler.js';
import type { RetentionSweepSummary, RetentionSweepTrigger } from './retention-sweep-trigger.js';

const EMPTY_SUMMARY: RetentionSweepSummary = {
  retentionScheduled: 0,
  retentionSkippedReferenced: 0,
  staleScheduled: 0,
  lostRaces: 0,
};

describe('createRetentionSweepScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the trigger once per interval', async () => {
    let calls = 0;
    const trigger: RetentionSweepTrigger = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createRetentionSweepScheduler(trigger, 1_000, silentLogger());

    scheduler.start();
    await vi.advanceTimersByTimeAsync(3_000);
    await scheduler.stop();

    expect(calls).toBe(3);
  });

  it('skips a firing while a previous run is still in flight, rather than overlapping', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const trigger: RetentionSweepTrigger = {
      trigger: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve(EMPTY_SUMMARY);
        });
      },
    };
    const scheduler = createRetentionSweepScheduler(trigger, 1_000, silentLogger());

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

  it('a failed run is logged and the next interval retries — one failure never stops the schedule', async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const trigger: RetentionSweepTrigger = {
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
    const scheduler = createRetentionSweepScheduler(trigger, 1_000, logger);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2_000);
    await scheduler.stop();

    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
  });

  it('stop() prevents further runs and resolves after any in-flight run finishes', async () => {
    let calls = 0;
    const trigger: RetentionSweepTrigger = {
      trigger: () => {
        calls += 1;
        return Promise.resolve(EMPTY_SUMMARY);
      },
    };
    const scheduler = createRetentionSweepScheduler(trigger, 1_000, silentLogger());

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls).toBe(1);
  });
});
