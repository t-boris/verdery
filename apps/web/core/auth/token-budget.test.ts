import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWithinBudget } from './token-budget';

const BUDGET_MS = 2_000;

describe('resolveWithinBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the value when the work settles inside the budget', async () => {
    const result = await resolveWithinBudget(() => Promise.resolve('token'), BUDGET_MS);

    expect(result).toBe('token');
  });

  it('leaves no timer pending once the work has settled', async () => {
    await resolveWithinBudget(() => Promise.resolve('token'), BUDGET_MS);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves null when the work rejects', async () => {
    const result = await resolveWithinBudget(
      () => Promise.reject(new Error('no token')),
      BUDGET_MS,
    );

    expect(result).toBeNull();
  });

  // The failure this whole module exists for: a promise that never settles.
  // Before the budget, awaiting it blocked every request behind it forever.
  it('resolves null when the work never settles', async () => {
    const pending = resolveWithinBudget(() => new Promise<string>(() => {}), BUDGET_MS);

    await vi.advanceTimersByTimeAsync(BUDGET_MS);

    await expect(pending).resolves.toBeNull();
  });

  it('absorbs a rejection that arrives after the budget has elapsed', async () => {
    let fail: (reason: Error) => void = () => {};
    const pending = resolveWithinBudget(
      () =>
        new Promise<string>((_resolve, reject) => {
          fail = reject;
        }),
      BUDGET_MS,
    );

    await vi.advanceTimersByTimeAsync(BUDGET_MS);
    await expect(pending).resolves.toBeNull();

    // Nothing observes this rejection but the handler inside the helper; an
    // unhandled one here would fail the run.
    fail(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);
  });
});
