/**
 * Direct unit tests for `rule-support.ts`'s calendar-month arithmetic
 * (P9D-SEASON-RULES-01) — `monthInRange`'s year-boundary wraparound in
 * particular, since it is the one piece of new rule-engine logic this
 * stage adds that is genuinely easy to get backwards. The rules that
 * CONSUME these helpers (`seasonal-sowing-window-check` above all) are
 * exercised black-box through the fixture suite
 * (`tests/rule-fixtures/seasonal-sowing-window-check.fixtures.ts`); this
 * file additionally pins the pure arithmetic directly, the same way
 * `garden-facts.test.ts` pins `deriveHemisphere` directly alongside the
 * rules that consume it.
 */

import { describe, expect, it } from 'vitest';
import { daysUntilNextMonthStart, monthInRange } from './rule-support.js';

describe('monthInRange', () => {
  it('matches an ordinary same-year window', () => {
    expect(monthInRange(3, 3, 5)).toBe(true);
    expect(monthInRange(5, 3, 5)).toBe(true);
    expect(monthInRange(4, 3, 5)).toBe(true);
    expect(monthInRange(2, 3, 5)).toBe(false);
    expect(monthInRange(6, 3, 5)).toBe(false);
  });

  it('treats equal bounds as a single-month window, not "every month"', () => {
    expect(monthInRange(6, 6, 6)).toBe(true);
    expect(monthInRange(5, 6, 6)).toBe(false);
    expect(monthInRange(7, 6, 6)).toBe(false);
  });

  it('WRAPS across the year boundary: November-February covers 11, 12, 1, 2, nothing else', () => {
    // The month-wraparound case this stage's own brief calls out by name.
    expect(monthInRange(11, 11, 2)).toBe(true);
    expect(monthInRange(12, 11, 2)).toBe(true);
    expect(monthInRange(1, 11, 2)).toBe(true);
    expect(monthInRange(2, 11, 2)).toBe(true);
    expect(monthInRange(3, 11, 2)).toBe(false);
    expect(monthInRange(10, 11, 2)).toBe(false);
  });

  it('wraps a window that starts in December and ends in January', () => {
    expect(monthInRange(12, 12, 1)).toBe(true);
    expect(monthInRange(1, 12, 1)).toBe(true);
    expect(monthInRange(6, 12, 1)).toBe(false);
  });
});

describe('daysUntilNextMonthStart', () => {
  it('returns 0 when `from` already sits on the target month’s own 1st', () => {
    expect(daysUntilNextMonthStart(new Date('2026-03-01T00:00:00Z'), 3)).toBe(0);
  });

  it('counts forward to a later month in the SAME year', () => {
    // 2026-03-15 -> 2026-05-01 is 47 days (16 remaining in March + 30 in April + 1).
    expect(daysUntilNextMonthStart(new Date('2026-03-15T00:00:00Z'), 5)).toBe(47);
  });

  it('wraps into NEXT year when the target month already passed this year', () => {
    // 2026-07-25 -> the next March 1st is 2027-03-01, not 2026-03-01 (already past).
    const daysUntil = daysUntilNextMonthStart(new Date('2026-07-25T00:00:00Z'), 3);
    expect(daysUntil).toBe(
      Math.round((Date.UTC(2027, 2, 1) - Date.UTC(2026, 6, 25)) / (24 * 60 * 60 * 1000)),
    );
    expect(daysUntil).toBeGreaterThan(200);
  });

  it('ignores time-of-day on `from` — only the calendar date matters', () => {
    const morning = daysUntilNextMonthStart(new Date('2026-03-15T01:00:00Z'), 5);
    const evening = daysUntilNextMonthStart(new Date('2026-03-15T23:00:00Z'), 5);
    expect(morning).toBe(evening);
  });
});
