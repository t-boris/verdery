import type { Locale } from './locales';

/**
 * Locale- and zone-aware presentation of the contract's date and time values.
 *
 * Two distinct value shapes arrive from the API and must not be formatted the
 * same way:
 *
 * - An *instant* (`completedAt`, `observedAt`, a recommendation window bound)
 *   is an RFC 3339 timestamp. It is rendered in the reader's own time zone,
 *   because a gardener reading "act before 18:00" needs 18:00 on the clock in
 *   front of them, not in UTC and not in whichever zone the server runs in.
 *   `Intl.DateTimeFormat` defaults to the runtime zone, which in a browser is
 *   the operating system's — that default is relied on deliberately rather
 *   than pinned, and is asserted in the tests.
 *
 * - A *calendar day* (`dueDate`) is a bare `YYYY-MM-DD` with no zone at all.
 *   Passing it through `new Date(...)` would parse it as UTC midnight and then
 *   re-project it into the reader's zone, so a task due on the 5th displays as
 *   the 4th anywhere west of Greenwich. The parts are therefore read from the
 *   string and handed to `Intl` as a local-noon date, which no zone can shift
 *   across a day boundary.
 *
 * The locale is always passed explicitly. `toLocaleString()` with no argument
 * follows the JavaScript runtime's default locale, which is the *browser's*
 * language on the client and the *server's* on the server — neither of which
 * is the locale this application negotiated for the request. A reader who
 * chose Russian would otherwise get Russian prose around an English date.
 *
 * Source: architecture/web-application-design.md, section "15. Localization"
 * ("Dates, time zones, seasons, units, and decimal formatting use the user's
 * locale and garden location as appropriate");
 * technical-specification.md, section 12.5.
 */

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
  timeStyle: 'short',
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium',
};

const CALENDAR_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * Formats an RFC 3339 instant as a date and time in the reader's own zone.
 *
 * Returns the input unchanged when it is not a parseable timestamp, so an
 * unexpected server value degrades to something readable instead of
 * "Invalid Date".
 */
export function formatInstant(value: string, locale: Locale): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, DATE_TIME_OPTIONS).format(parsed);
}

/**
 * Formats a bare `YYYY-MM-DD` calendar day without ever re-projecting it
 * through a time zone.
 */
export function formatCalendarDay(value: string, locale: Locale): string {
  const match = CALENDAR_DAY_PATTERN.exec(value);

  if (match === null) {
    return value;
  }

  const [, year, month, day] = match;
  // Local noon, not local midnight: a daylight-saving transition at midnight
  // (which several zones do have) could otherwise land the date on the
  // previous day even within a single zone.
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, DATE_OPTIONS).format(parsed);
}

/**
 * Formats a number with a fixed number of fraction digits, in the reader's
 * locale.
 *
 * `Number.prototype.toFixed` always emits a POSIX full stop, so a Russian
 * reader saw `1.5` inside otherwise-Russian prose. The digit count is kept
 * as an explicit argument because the calibration figures deliberately show
 * no more digits than the estimate supports, and that decision belongs to
 * the caller, not to `Intl`'s defaults.
 */
export function formatFixed(value: number, fractionDigits: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: false,
  }).format(value);
}

/** The reader's IANA time-zone name, as resolved by the JavaScript runtime. */
export function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
