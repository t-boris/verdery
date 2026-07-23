import { describe, expect, it } from 'vitest';
import { computePullLagMilliseconds } from './sync-pull-lag.js';

describe('computePullLagMilliseconds', () => {
  it('returns undefined for an empty page — nothing pulled, nothing to measure', () => {
    expect(computePullLagMilliseconds([], new Date('2026-01-01T00:00:00.000Z'))).toBeUndefined();
  });

  it('measures against the last item on the page, not the first', () => {
    const now = new Date('2026-01-01T00:10:00.000Z');
    const items = [
      { committedAt: '2026-01-01T00:00:00.000Z' }, // 10 minutes before `now`
      { committedAt: '2026-01-01T00:07:00.000Z' }, // 3 minutes before `now`
    ];

    expect(computePullLagMilliseconds(items, now)).toBe(3 * 60 * 1000);
  });

  it('never returns a negative value for a clock read slightly behind committedAt', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const items = [{ committedAt: '2026-01-01T00:00:00.500Z' }];

    expect(computePullLagMilliseconds(items, now)).toBe(0);
  });
});
