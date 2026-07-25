/**
 * Minimal RFC-4180 CSV writing for the export package's tabular views
 * (P8-EXPORT-01) — hand-rolled rather than a dependency because the whole
 * requirement is one escaping rule: quote a field containing a comma,
 * quote, CR, or LF, doubling embedded quotes. Values are already plain
 * scalars by the time they reach here; `null`/`undefined` serialize as the
 * empty field, the conventional CSV representation of absence.
 */

export type CsvValue = string | number | boolean | null | undefined;

const MUST_QUOTE = /[",\r\n]/u;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : String(value);
  if (!MUST_QUOTE.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

/** One header row plus one row per record, CRLF line endings (RFC 4180), trailing newline included. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(escapeField).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeField).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
