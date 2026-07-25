import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatCalendarDay, formatInstant, resolvedTimeZone } from './formatting';

/**
 * The behaviours asserted here are the ones the previous `toLocaleString()`
 * call sites silently got wrong: the negotiated locale was ignored, and a
 * bare calendar day was re-projected through a time zone.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Non-breaking and narrow no-break spaces vary by ICU build; they are not the point of any assertion. */
const normalize = (value: string) => value.replace(/[\u00a0\u202f]/gu, ' ');

describe('formatInstant', () => {
  it('renders in the passed locale rather than the runtime default', () => {
    const value = '2026-03-14T09:05:00Z';

    const english = formatInstant(value, 'en');
    const russian = formatInstant(value, 'ru');

    expect(english).not.toBe(russian);
    // Each names the month in its own language.
    expect(english).toMatch(/Mar/u);
    expect(russian).toMatch(/мар/u);
  });

  it('renders the instant in the reader time zone, not in UTC', () => {
    const value = '2026-03-14T23:30:00Z';

    const tokyo = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tokyo',
    }).format(new Date(value));
    const utc = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value));

    // 23:30Z is the next calendar day in Tokyo: the two renderings must differ,
    // which is what makes "the reader's own zone" an observable property.
    expect(tokyo).not.toBe(utc);

    // The formatter under test pins no zone, so it must agree with whichever
    // zone this process actually runs in.
    const runtime = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: resolvedTimeZone(),
    }).format(new Date(value));
    expect(formatInstant(value, 'en')).toBe(runtime);
  });

  it('includes both the date and the time of day', () => {
    expect(normalize(formatInstant('2026-03-14T09:05:00Z', 'en'))).toMatch(/\d{1,2}:\d{2}/u);
  });

  it('returns an unparseable value unchanged instead of "Invalid Date"', () => {
    expect(formatInstant('not-a-timestamp', 'en')).toBe('not-a-timestamp');
  });
});

describe('formatCalendarDay', () => {
  it('never shifts a bare calendar day across a day boundary', () => {
    // `new Date('2026-03-14')` is UTC midnight, which is 13 March anywhere
    // west of Greenwich. The day number must survive regardless of zone.
    for (const locale of ['en', 'ru'] as const) {
      expect(formatCalendarDay('2026-03-14', locale)).toMatch(/14/u);
      expect(formatCalendarDay('2026-01-01', locale)).toMatch(/1/u);
    }
  });

  it('renders in the passed locale', () => {
    expect(formatCalendarDay('2026-03-14', 'en')).toMatch(/Mar/u);
    expect(formatCalendarDay('2026-03-14', 'ru')).toMatch(/мар/u);
  });

  it('carries no time of day', () => {
    expect(formatCalendarDay('2026-03-14', 'en')).not.toMatch(/\d{1,2}:\d{2}/u);
  });

  it('returns a value that is not a calendar day unchanged', () => {
    expect(formatCalendarDay('2026-03-14T09:00:00Z', 'en')).toBe('2026-03-14T09:00:00Z');
    expect(formatCalendarDay('', 'en')).toBe('');
  });
});

describe('resolvedTimeZone', () => {
  it('reports an IANA zone name', () => {
    expect(resolvedTimeZone()).toMatch(/^[A-Za-z]+(\/[A-Za-z_+\-0-9]+)*$/u);
  });
});
