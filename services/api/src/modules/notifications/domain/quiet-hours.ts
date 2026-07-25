/**
 * Quiet-hours evaluation with real IANA time-zone rules (P7-NOTIF-01).
 *
 * "Garden-care timing uses the garden or user time zone inside application
 * logic" (notifications.md section 9) and section 16 explicitly names
 * "Quiet hours and daylight-saving transitions" a tested behavior — so this
 * file does real calendar math against the platform's own zone database
 * (`Intl`, ICU-backed — no new dependency), never a fixed UTC offset.
 *
 * A quiet window is a daily do-not-push interval in the recipient's local
 * wall-clock time, `[startMinute, endMinute)` minutes after local midnight,
 * allowed to wrap midnight (start > end means 22:00-07:00). The window
 * defers PUSH delivery only; the in-app inbox entry is never delayed
 * (section 5 persists the in-app intent before any delivery scheduling).
 *
 * The deferral target is THE EARLIEST INSTANT AFTER NOW at which the
 * recipient's wall clock shows the window's end minute. That one rule pins
 * both daylight-saving edge cases, and the tests hold it to that:
 *
 * - A window end on a NONEXISTENT local time (spring-forward gap) resolves
 *   through the pre-transition offset to the first instant after the gap at
 *   the shifted wall clock (a 02:30 end on a 02:00→03:00 gap day delivers
 *   at 03:30 local) — delivery resumes right after the gap instead of
 *   slipping a whole day.
 * - A window end on an AMBIGUOUS local time (fall-back overlap) resolves to
 *   whichever occurrence is the first still ahead of `now` — never a
 *   day-long deferral because an earlier occurrence already passed.
 *
 * An invalid zone identifier throws: both writers of zone values validate
 * with `isValidIanaTimeZone` first (`UpdateNotificationPreferences` for the
 * override, profile provisioning's `'UTC'` default for the profile zone),
 * so an invalid zone reaching evaluation is a defect surfaced loudly, never
 * silently rescheduled.
 */

import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';

export interface QuietHours {
  /** Minutes after local midnight, 0..1439. */
  readonly startMinute: number;
  /** Minutes after local midnight, 0..1439; never equal to `startMinute`. */
  readonly endMinute: number;
}

export const MINUTES_PER_DAY = 1440;

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;

/** True when `zone` is a time-zone identifier the platform's ICU data resolves. */
export function isValidIanaTimeZone(zone: string): boolean {
  if (zone === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Throws unless the window is structurally valid (bounds and non-degeneracy — the migration's own CHECK, enforced in code first). */
export function validateQuietHours(window: QuietHours): void {
  const inRange = (minute: number): boolean =>
    Number.isInteger(minute) && minute >= 0 && minute < MINUTES_PER_DAY;

  if (!inRange(window.startMinute) || !inRange(window.endMinute)) {
    throw new DomainRuleViolatedError(
      'notification.quiet_hours.minute_out_of_range',
      'Quiet-hours minutes must be integers between 0 and 1439.',
    );
  }
  if (window.startMinute === window.endMinute) {
    throw new DomainRuleViolatedError(
      'notification.quiet_hours.degenerate_window',
      'Quiet hours must not start and end at the same minute; disable the push channel instead.',
    );
  }
}

interface LocalWallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly minuteOfDay: number;
}

function wallClockInZone(instant: Date, timeZone: string): LocalWallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) {
      throw new DomainRuleViolatedError(
        'notification.quiet_hours.zone_unreadable',
        `The time zone "${timeZone}" produced no ${type} component.`,
      );
    }
    return Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    minuteOfDay: read('hour') * 60 + read('minute'),
  };
}

/** The zone's UTC offset at `instant`, in minutes (positive east of Greenwich). Modern zone offsets are minute-aligned. */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const wall = wallClockInZone(instant, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, 0, wall.minuteOfDay);
  const instantWholeMinutes =
    Math.floor(instant.getTime() / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE;
  return Math.round((wallAsUtc - instantWholeMinutes) / MILLISECONDS_PER_MINUTE);
}

/**
 * Every instant at which the zone's wall clock shows `minuteOfDay` on the
 * local calendar day `(year, month, day)`, ascending — two instants in a
 * fall-back overlap, one ordinarily, and for a spring-forward gap (no
 * instant shows the requested time at all) the single post-gap instant the
 * pre-transition offset maps to.
 *
 * Offsets are probed one day before, at, and one day after the target wall
 * time so a transition on the target day contributes BOTH its offsets —
 * probing only at the target (the naive refinement) finds one side of a
 * fall-back overlap and silently misses the other occurrence.
 */
function instantsForLocalWallTime(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): readonly Date[] {
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minuteOfDay);

  const probeOffsets = [-MILLISECONDS_PER_DAY, 0, MILLISECONDS_PER_DAY]
    .map((probe) => offsetMinutesAt(new Date(wallAsUtc + probe), timeZone))
    .filter((offset, index, all) => all.indexOf(offset) === index);

  const candidates = probeOffsets
    .map((offset) => new Date(wallAsUtc - offset * MILLISECONDS_PER_MINUTE))
    .filter(
      (candidate, index, all) =>
        all.findIndex((other) => other.getTime() === candidate.getTime()) === index,
    )
    .sort((a, b) => a.getTime() - b.getTime());

  const reproduces = (candidate: Date): boolean => {
    const wall = wallClockInZone(candidate, timeZone);
    return (
      wall.minuteOfDay === minuteOfDay &&
      wall.year === year &&
      wall.month === month &&
      wall.day === day
    );
  };

  const matches = candidates.filter(reproduces);
  if (matches.length > 0) {
    return matches;
  }

  // Spring-forward gap: no offset reproduces the wall time. The candidate
  // built from the PRE-transition offset is always the latest one (a gap
  // means the offset increased), and it lands just after the gap at the
  // shifted wall clock.
  return [candidates[candidates.length - 1] as Date];
}

/** True when the zone's wall clock at `instant` falls inside the (possibly midnight-wrapping) window. Start-inclusive, end-exclusive. */
export function isWithinQuietHours(instant: Date, window: QuietHours, timeZone: string): boolean {
  validateQuietHours(window);
  const minute = wallClockInZone(instant, timeZone).minuteOfDay;

  if (window.startMinute < window.endMinute) {
    return minute >= window.startMinute && minute < window.endMinute;
  }
  return minute >= window.startMinute || minute < window.endMinute;
}

/**
 * The earliest instant push delivery may be attempted: `now` when no window
 * applies or `now` is outside it, otherwise the earliest instant after
 * `now` at which the zone's wall clock shows the window's end minute — see
 * this file's header for the daylight-saving semantics that rule pins.
 */
export function resolveEarliestDeliveryAt(
  now: Date,
  window: QuietHours | null,
  timeZone: string,
): Date {
  if (window === null) {
    return now;
  }
  if (!isWithinQuietHours(now, window, timeZone)) {
    return now;
  }

  const local = wallClockInZone(now, timeZone);

  // From inside the window, the next wall-clock occurrence of the end
  // minute is the current quiet period's own end (a window spans less than
  // a day, so no start can intervene). Scan today then forward; two extra
  // days bound every wrap and transition case.
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const dayAnchor = new Date(
      Date.UTC(local.year, local.month - 1, local.day) + dayOffset * MILLISECONDS_PER_DAY,
    );
    const candidates = instantsForLocalWallTime(
      dayAnchor.getUTCFullYear(),
      dayAnchor.getUTCMonth() + 1,
      dayAnchor.getUTCDate(),
      window.endMinute,
      timeZone,
    );
    const next = candidates.find((candidate) => candidate.getTime() > now.getTime());
    if (next !== undefined) {
      return next;
    }
  }

  throw new DomainRuleViolatedError(
    'notification.quiet_hours.end_unresolvable',
    `The quiet-hours end could not be resolved in zone "${timeZone}".`,
  );
}
