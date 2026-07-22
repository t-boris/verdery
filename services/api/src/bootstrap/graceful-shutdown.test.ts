import { describe, expect, it } from 'vitest';
import { shutdownWithTimeout } from './graceful-shutdown.js';

describe('shutdownWithTimeout', () => {
  it('completes when the drain finishes inside the grace period', async () => {
    let drained = false;

    const outcome = await shutdownWithTimeout(() => {
      drained = true;
      return Promise.resolve();
    }, 1_000);

    expect(outcome).toBe('completed');
    expect(drained).toBe(true);
  });

  it('reports a drain that outlives the grace period instead of hanging', async () => {
    const outcome = await shutdownWithTimeout(
      () =>
        new Promise<void>((resolve) => {
          // Unreferenced so the abandoned drain cannot keep the test process alive.
          setTimeout(resolve, 5_000).unref();
        }),
      10,
    );

    expect(outcome).toBe('timedOut');
  });

  it('propagates a drain failure so the process can exit non-zero', async () => {
    await expect(
      shutdownWithTimeout(() => Promise.reject(new Error('pool close failed')), 1_000),
    ).rejects.toThrow('pool close failed');
  });
});
