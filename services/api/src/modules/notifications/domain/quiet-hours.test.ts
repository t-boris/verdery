/**
 * Quiet-hours policy tests (P7-NOTIF-01) — notifications.md section 16's
 * "Quiet hours and daylight-saving transitions" named explicitly. Every
 * expectation is a concrete UTC instant computed by hand from the IANA
 * rules for 2026: Europe/Berlin springs forward 2026-03-29 02:00→03:00
 * CET→CEST and falls back 2026-10-25 03:00→02:00; America/New_York
 * springs forward 2026-03-08 02:00→03:00 EST→EDT and falls back
 * 2026-11-01 02:00→01:00.
 */

import { describe, expect, it } from 'vitest';
import { DomainRuleViolatedError } from '../../../platform/errors/application-error.js';
import {
  isValidIanaTimeZone,
  isWithinQuietHours,
  resolveEarliestDeliveryAt,
  validateQuietHours,
} from './quiet-hours.js';

const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

/** 22:00-07:00 — the archetypal overnight window. */
const OVERNIGHT = { startMinute: 22 * 60, endMinute: 7 * 60 };

describe('isValidIanaTimeZone', () => {
  it('accepts real zones and UTC', () => {
    expect(isValidIanaTimeZone(BERLIN)).toBe(true);
    expect(isValidIanaTimeZone('UTC')).toBe(true);
  });

  it('rejects garbage and the empty string', () => {
    expect(isValidIanaTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidIanaTimeZone('')).toBe(false);
  });
});

describe('validateQuietHours', () => {
  it('rejects out-of-range and non-integer minutes', () => {
    expect(() => validateQuietHours({ startMinute: -1, endMinute: 60 })).toThrow(
      DomainRuleViolatedError,
    );
    expect(() => validateQuietHours({ startMinute: 0, endMinute: 1440 })).toThrow(
      DomainRuleViolatedError,
    );
    expect(() => validateQuietHours({ startMinute: 90.5, endMinute: 120 })).toThrow(
      DomainRuleViolatedError,
    );
  });

  it('rejects a degenerate window (start equals end)', () => {
    expect(() => validateQuietHours({ startMinute: 300, endMinute: 300 })).toThrow(
      DomainRuleViolatedError,
    );
  });
});

describe('isWithinQuietHours', () => {
  it('is start-inclusive and end-exclusive for a same-day window', () => {
    const window = { startMinute: 9 * 60, endMinute: 17 * 60 };
    // 09:00 Berlin summer (CEST, UTC+2) = 07:00Z.
    expect(isWithinQuietHours(new Date('2026-07-01T07:00:00Z'), window, BERLIN)).toBe(true);
    expect(isWithinQuietHours(new Date('2026-07-01T06:59:00Z'), window, BERLIN)).toBe(false);
    // 17:00 local = 15:00Z — the end minute itself is already outside.
    expect(isWithinQuietHours(new Date('2026-07-01T15:00:00Z'), window, BERLIN)).toBe(false);
  });

  it('wraps midnight when start is after end', () => {
    // 23:30 Berlin summer = 21:30Z — inside 22:00-07:00.
    expect(isWithinQuietHours(new Date('2026-07-01T21:30:00Z'), OVERNIGHT, BERLIN)).toBe(true);
    // 06:59 local = 04:59Z — still inside.
    expect(isWithinQuietHours(new Date('2026-07-01T04:59:00Z'), OVERNIGHT, BERLIN)).toBe(true);
    // 12:00 local — outside.
    expect(isWithinQuietHours(new Date('2026-07-01T10:00:00Z'), OVERNIGHT, BERLIN)).toBe(false);
  });

  it('evaluates the SAME instant differently per zone — the time-zone preference is load-bearing', () => {
    const instant = new Date('2026-07-01T23:00:00Z');
    // Berlin: 01:00 local (inside 22:00-07:00). Tokyo: 08:00 local (outside).
    expect(isWithinQuietHours(instant, OVERNIGHT, BERLIN)).toBe(true);
    expect(isWithinQuietHours(instant, OVERNIGHT, TOKYO)).toBe(false);
  });
});

describe('resolveEarliestDeliveryAt', () => {
  it('returns now unchanged when no window is configured', () => {
    const now = new Date('2026-07-01T02:00:00Z');
    expect(resolveEarliestDeliveryAt(now, null, BERLIN)).toEqual(now);
  });

  it('returns now unchanged outside the window', () => {
    const now = new Date('2026-07-01T10:00:00Z'); // 12:00 Berlin.
    expect(resolveEarliestDeliveryAt(now, OVERNIGHT, BERLIN)).toEqual(now);
  });

  it('defers to the same local morning inside an overnight window', () => {
    // 23:30 Berlin (21:30Z) -> 07:00 next local day = 05:00Z.
    const now = new Date('2026-07-01T21:30:00Z');
    expect(resolveEarliestDeliveryAt(now, OVERNIGHT, BERLIN)).toEqual(
      new Date('2026-07-02T05:00:00Z'),
    );
  });

  it('defers to the end of the current day for a same-day window entered after midnight', () => {
    // 02:00 Berlin (00:00Z) inside 22:00-07:00 -> 07:00 today = 05:00Z.
    const now = new Date('2026-07-02T00:00:00Z');
    expect(resolveEarliestDeliveryAt(now, OVERNIGHT, BERLIN)).toEqual(
      new Date('2026-07-02T05:00:00Z'),
    );
  });

  it('crosses the Berlin spring-forward night with the end an hour of UTC earlier', () => {
    // 2026-03-28 23:00 Berlin (22:00Z, CET) inside 22:00-07:00; clocks jump
    // 02:00->03:00 during the night, so 07:00 CEST on the 29th is 05:00Z —
    // only 7h of real time despite the 8-wall-hour window.
    const now = new Date('2026-03-28T22:00:00Z');
    expect(resolveEarliestDeliveryAt(now, OVERNIGHT, BERLIN)).toEqual(
      new Date('2026-03-29T05:00:00Z'),
    );
  });

  it('crosses the Berlin fall-back night with the end an hour of UTC later', () => {
    // 2026-10-24 23:00 Berlin (21:00Z, CEST) inside 22:00-07:00; clocks
    // fall back 03:00->02:00, so 07:00 CET on the 25th is 06:00Z — 9h of
    // real time for the 8-wall-hour window.
    const now = new Date('2026-10-24T21:00:00Z');
    expect(resolveEarliestDeliveryAt(now, OVERNIGHT, BERLIN)).toEqual(
      new Date('2026-10-25T06:00:00Z'),
    );
  });

  it('maps an end minute inside the New York spring-forward gap to just after the gap', () => {
    // Window 00:00-02:30 on 2026-03-08 in New York: 02:30 EST does not
    // exist (02:00 EST jumps to 03:00 EDT at 07:00Z). From 01:30 EST
    // (06:30Z, inside), the end resolves via the pre-transition offset to
    // 07:30Z = 03:30 EDT — right after the gap, not a day later.
    const window = { startMinute: 0, endMinute: 150 };
    const now = new Date('2026-03-08T06:30:00Z');
    expect(resolveEarliestDeliveryAt(now, window, NEW_YORK)).toEqual(
      new Date('2026-03-08T07:30:00Z'),
    );
  });

  it('picks the FIRST occurrence of an ambiguous fall-back end still ahead of now', () => {
    // Window 00:30-01:30 on 2026-11-01 in New York: 01:30 occurs twice
    // (05:30Z EDT, 06:30Z EST). At 01:00 EDT (05:00Z) the first
    // occurrence is still ahead — delivery at 05:30Z.
    const window = { startMinute: 30, endMinute: 90 };
    const now = new Date('2026-11-01T05:00:00Z');
    expect(resolveEarliestDeliveryAt(now, window, NEW_YORK)).toEqual(
      new Date('2026-11-01T05:30:00Z'),
    );
  });

  it('picks the SECOND occurrence of an ambiguous fall-back end when the first already passed', () => {
    // Same window, but at 01:15 EST (06:15Z) — the repeated hour's second
    // pass, wall clock inside the window again. The first 01:30 (05:30Z)
    // is behind; the honest end is the second occurrence, 06:30Z — 15
    // minutes away, never tomorrow.
    const window = { startMinute: 30, endMinute: 90 };
    const now = new Date('2026-11-01T06:15:00Z');
    expect(resolveEarliestDeliveryAt(now, window, NEW_YORK)).toEqual(
      new Date('2026-11-01T06:30:00Z'),
    );
  });

  it('handles a zone without daylight saving as plain offset arithmetic', () => {
    // 23:00 Tokyo (14:00Z) inside 22:00-07:00 -> 07:00 next day = 22:00Z.
    const now = new Date('2026-07-01T14:00:00Z');
    expect(resolveEarliestDeliveryAt(now, OVERNIGHT, TOKYO)).toEqual(
      new Date('2026-07-01T22:00:00Z'),
    );
  });

  it('throws loudly for an invalid zone instead of silently rescheduling', () => {
    expect(() =>
      resolveEarliestDeliveryAt(new Date('2026-07-01T21:30:00Z'), OVERNIGHT, 'Not/AZone'),
    ).toThrow(RangeError);
  });
});
