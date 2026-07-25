import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDeadline } from './with-deadline.js';

describe('withDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes with the value when the work finishes before the deadline', async () => {
    const outcome = await withDeadline(1_000, () => Promise.resolve('done'));
    expect(outcome).toEqual({ kind: 'completed', value: 'done' });
  });

  it('times out, aborting the signal, when the work outlives the deadline', async () => {
    let aborted = false;
    const promise = withDeadline(1_000, (signal) => {
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'timedOut' });
    expect(aborted).toBe(true);
  });

  it('propagates a pre-deadline rejection to the caller', async () => {
    await expect(withDeadline(1_000, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
  });

  it('swallows a rejection arriving after the deadline already won', async () => {
    let rejectWork: ((error: Error) => void) | undefined;
    const promise = withDeadline(50, () => {
      return new Promise<string>((_resolve, reject) => {
        rejectWork = reject;
      });
    });

    await vi.advanceTimersByTimeAsync(50);
    const outcome = await promise;
    expect(outcome).toEqual({ kind: 'timedOut' });

    // The abandoned work rejecting later must not surface anywhere.
    rejectWork?.(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
  });
});
