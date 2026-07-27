/**
 * Tiny shared helpers for launch rule definitions — target construction,
 * time-unit conversion, and (P9D-SEASON-RULES-01) calendar-month/date
 * arithmetic. Anything resembling rule CONTENT (thresholds, stage lists,
 * templates) lives in each rule's own file, in its `parameters`, where the
 * horticultural reviewer reads it.
 *
 * `HEMISPHERE_UNKNOWN_DETAIL` is the one exception kept here rather than
 * duplicated in each of the three seasonal rules: it is not a
 * horticultural judgment (no threshold, no stage, no cadence a reviewer
 * tunes) — it is a single factual sentence three rules share VERBATIM
 * ("this garden has never been georeferenced"), and keeping one copy
 * removes the risk of the three drifting to subtly different wording for
 * the identical condition.
 */

import type { Uuid } from '../../../../shared/identifiers/uuid.js';
import type { RecommendationTarget } from '../recommendation-candidate.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** A plant-kind recommendation target, the shape every launch rule addresses. */
export function plantTarget(plantId: Uuid): RecommendationTarget {
  return { kind: 'plant', gardenAreaMapObjectId: null, plantId };
}

/** Whole elapsed days between two instants, floored — a derived fact for explanation text. */
export function wholeDaysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

/** Shared `RuleSkipReason.detail` text for the three seasonal rules' whole-rule skip on `GardenFacts.hemisphere === null` — see this file's own header for why this one string is shared. */
export const HEMISPHERE_UNKNOWN_DETAIL =
  "This garden has never been georeferenced, so its hemisphere — and therefore any taxon's " +
  'reviewed seasonal timing — is unknown.';

/**
 * Whether calendar `month` (`1`-`12`) falls within the inclusive range
 * `[startMonth, endMonth]`, WRAPPING across the year boundary when
 * `startMonth > endMonth` — a window like November-February
 * (`startMonth: 11, endMonth: 2`) covers months 11, 12, 1, 2. Equal bounds
 * (`startMonth === endMonth`) is a single-month window, not "every month":
 * `month >= startMonth && month <= endMonth` already resolves that case
 * correctly without a special branch.
 */
export function monthInRange(month: number, startMonth: number, endMonth: number): boolean {
  if (startMonth <= endMonth) {
    return month >= startMonth && month <= endMonth;
  }
  return month >= startMonth || month <= endMonth;
}

/**
 * Whole days from `from` (its own UTC calendar date, time-of-day ignored)
 * until the NEXT occurrence of the 1st of `targetMonth` — THIS year's if
 * it has not yet passed, otherwise next year's, so the result is always
 * `>= 0` (a `from` that already sits on `targetMonth`'s own 1st returns
 * `0`, "starts today"). Calendar-month arithmetic via `Date.UTC`, not a
 * flat `* DAY_MS` multiplication, so months of different lengths (and any
 * leap-year February) are handled correctly.
 */
export function daysUntilNextMonthStart(from: Date, targetMonth: number): number {
  const year = from.getUTCFullYear();
  const todayStart = Date.UTC(year, from.getUTCMonth(), from.getUTCDate());
  const thisYearTarget = Date.UTC(year, targetMonth - 1, 1);
  const targetStart =
    thisYearTarget >= todayStart ? thisYearTarget : Date.UTC(year + 1, targetMonth - 1, 1);
  return Math.round((targetStart - todayStart) / DAY_MS);
}
