/**
 * P9-QA-01, Batch B, Matrix 8 (DST) — P9D seasonal-window arithmetic
 * sub-case: `rule-support.ts`'s `daysUntilNextMonthStart`/`wholeDaysBetween`
 * and `garden-facts.ts`'s `deriveHemisphere`.
 *
 * `rule-support.test.ts` already pins `daysUntilNextMonthStart`'s ordinary
 * behavior (same-year, year-wrap, time-of-day-independence) and
 * `monthInRange`'s wraparound; `garden-facts.test.ts` already pins
 * `deriveHemisphere`'s latitude-sign/equator behavior. Neither file forces
 * the host process into a NON-UTC time zone, so neither would actually
 * FAIL if `getUTCMonth()`/`getUTCDate()` were accidentally swapped for
 * `getMonth()`/`getDate()` on a CI runner whose own local zone happens to be
 * UTC (a common CI default) — the local and UTC calendar date would agree
 * there by coincidence, silently hiding exactly the class of regression
 * this matrix exists to catch.
 *
 * This suite closes that gap: it explicitly sets `process.env['TZ']` to a real
 * zone with an active DST transition, picks UTC instants whose LOCAL
 * calendar date in that zone provably DISAGREES with their UTC calendar
 * date, and confirms the real functions still answer according to the UTC
 * date — the only way they could, given their own implementation reads
 * `getUTCFullYear`/`getUTCMonth`/`getUTCDate`/`Date.UTC` exclusively
 * (`rule-support.ts`, confirmed by inspection). A regression to local
 * accessors would fail these specific assertions even though it would pass
 * every existing test in a UTC-zoned CI runner.
 *
 * `deriveHemisphere` takes a `Position` (`[longitude, latitude]`), never a
 * `Date` — there is no temporal input for a DST transition to affect at
 * all. This suite still asserts its answer is identical across time-zone
 * process settings, the cheapest possible behavioral confirmation that no
 * hidden clock dependency exists, without inventing a fake Date-based
 * scenario for a function that structurally has none.
 */

import type { Position } from '@verdery/geometry-contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveHemisphere } from '../../src/modules/tasks-recommendations/domain/garden-facts.js';
import {
  daysUntilNextMonthStart,
  wholeDaysBetween,
} from '../../src/modules/tasks-recommendations/domain/rules/rule-support.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGINAL_TZ = process.env['TZ'];

function withProcessTimeZone<T>(zone: string, run: () => T): T {
  process.env['TZ'] = zone;
  try {
    return run();
  } finally {
    if (ORIGINAL_TZ === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = ORIGINAL_TZ;
    }
  }
}

describe('DST sweep: rule-support.ts arithmetic under a non-UTC host process time zone', () => {
  beforeEach(() => {
    expect(process.env['TZ']).toBe(ORIGINAL_TZ);
  });

  afterEach(() => {
    // Every `it` restores TZ itself via `withProcessTimeZone`'s `finally`;
    // this is a belt-and-suspenders guard against a failed assertion
    // leaving TZ mutated for suites that run later in the same worker.
    if (ORIGINAL_TZ === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = ORIGINAL_TZ;
    }
  });

  describe('wholeDaysBetween', () => {
    it('reports 0 whole days for a 7-hour gap that crosses a LOCAL New York midnight and DST transition, not the 1 a local-calendar-day count would give', () => {
      // 2026-03-08T01:00:00Z = 2026-03-07 20:00 EST (pre-transition) local.
      // 2026-03-08T08:00:00Z = 2026-03-08 04:00 EDT (post-transition) local.
      // Different LOCAL calendar dates (Mar 7 vs Mar 8), but only 7 real
      // hours elapsed — a `Date.UTC(localY,localM,localD)` subtraction bug
      // would report 1 "day"; true millisecond math reports 0.
      const earlier = new Date('2026-03-08T01:00:00Z');
      const later = new Date('2026-03-08T08:00:00Z');
      const result = withProcessTimeZone('America/New_York', () =>
        wholeDaysBetween(earlier, later),
      );
      expect(result).toBe(0);
    });

    it('reports exactly 2 whole days across the New York spring-forward night, never 1 or 3 because a real hour was skipped locally', () => {
      const earlier = new Date('2026-03-07T09:00:00Z');
      const later = new Date('2026-03-09T09:00:00Z');
      const result = withProcessTimeZone('America/New_York', () =>
        wholeDaysBetween(earlier, later),
      );
      expect(result).toBe(2);
      expect(later.getTime() - earlier.getTime()).toBe(2 * DAY_MS);
    });

    it('reports exactly 2 whole days across the New York fall-back night, never 1 or 3 because a real hour repeated locally', () => {
      const earlier = new Date('2026-10-31T09:00:00Z');
      const later = new Date('2026-11-02T09:00:00Z');
      const result = withProcessTimeZone('America/New_York', () =>
        wholeDaysBetween(earlier, later),
      );
      expect(result).toBe(2);
      expect(later.getTime() - earlier.getTime()).toBe(2 * DAY_MS);
    });
  });

  describe('daysUntilNextMonthStart', () => {
    it('answers 0 (already on March 1st) for a UTC instant whose New York LOCAL date is still February 28th', () => {
      // 2026-03-01T02:00:00Z is UTC calendar date March 1st (the function's
      // own claimed input), but 21:00 EST on Feb 28th in New York — a
      // zone BEHIND UTC. A `getMonth()`/`getDate()`-based implementation
      // would read "Feb 28", one day short of March 1st, and answer 1.
      const from = new Date('2026-03-01T02:00:00Z');
      const result = withProcessTimeZone('America/New_York', () =>
        daysUntilNextMonthStart(from, 3),
      );
      expect(result).toBe(0);
    });

    it('answers 1 (not yet March 1st) for a UTC instant whose Auckland LOCAL date is already March 1st', () => {
      // 2026-02-28T20:00:00Z is UTC calendar date February 28th, but 09:00
      // NZDT on March 1st in Auckland — a zone AHEAD of UTC, and one that
      // itself observes daylight saving (NZDT runs late September to early
      // April, so late February sits inside it). A local-accessor bug
      // would read "March 1", already the target, and wrongly answer 0.
      const from = new Date('2026-02-28T20:00:00Z');
      const result = withProcessTimeZone('Pacific/Auckland', () =>
        daysUntilNextMonthStart(from, 3),
      );
      expect(result).toBe(1);
    });

    it('gives an identical answer regardless of the host process time zone, for the SAME UTC instant', () => {
      const from = new Date('2026-03-08T06:30:00Z'); // Mid-transition instant, New York spring-forward.
      const utcAnswer = withProcessTimeZone('UTC', () => daysUntilNextMonthStart(from, 6));
      const nyAnswer = withProcessTimeZone('America/New_York', () =>
        daysUntilNextMonthStart(from, 6),
      );
      const aucklandAnswer = withProcessTimeZone('Pacific/Auckland', () =>
        daysUntilNextMonthStart(from, 6),
      );
      expect(nyAnswer).toBe(utcAnswer);
      expect(aucklandAnswer).toBe(utcAnswer);
    });
  });

  describe('deriveHemisphere', () => {
    it('has no Date parameter at all — a DST transition has nothing to affect; confirmed identical across process time zones as the cheapest possible proof', () => {
      const amsterdam: Position = [4.895, 52.37];
      const sydney: Position = [151.21, -33.87];
      const equator: Position = [0, 0];

      for (const zone of ['UTC', 'America/New_York', 'Pacific/Auckland']) {
        expect(withProcessTimeZone(zone, () => deriveHemisphere(amsterdam))).toBe('northern');
        expect(withProcessTimeZone(zone, () => deriveHemisphere(sydney))).toBe('southern');
        expect(withProcessTimeZone(zone, () => deriveHemisphere(equator))).toBe('northern');
        expect(withProcessTimeZone(zone, () => deriveHemisphere(null))).toBeNull();
      }
    });
  });
});
