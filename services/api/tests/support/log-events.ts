/**
 * Helpers for asserting structured log events captured through
 * `buildTestApplication`'s `onLogRecord` — events are verified parsed, by
 * their `event` field, never by raw string search (the P5-OBS-01
 * convention `sync-routes.test.ts` established).
 */

/** The most recently logged record whose `event` field matches. */
export function lastLogEvent(
  logRecords: readonly string[],
  event: string,
): Record<string, unknown> | undefined {
  const matches = logRecords
    .map((record) => JSON.parse(record) as Record<string, unknown>)
    .filter((parsed) => parsed['event'] === event);
  return matches.at(-1);
}

/**
 * Fields the logging pipeline itself stamps on every line — the pino base
 * (`service`/`version`/`environment`), the level formatter, the timestamp,
 * the request-scoped bindings (`reqId`, `correlationId`), the
 * OpenTelemetry mixin (`traceId`/`spanId`), and the message.
 */
const PIPELINE_KEYS: ReadonlySet<string> = new Set([
  'level',
  'severity',
  'time',
  'service',
  'version',
  'environment',
  'reqId',
  'correlationId',
  'traceId',
  'spanId',
  'msg',
]);

/**
 * The record's payload keys after removing what the logging pipeline
 * stamps on every line — what remains is exactly the fields the emitting
 * call site chose, so an exact-set comparison pins the event's field
 * allowlist at its emission point (P7-ANALYTICS-01's consent boundary: a
 * new field cannot ship without being consciously admitted by the
 * asserting test).
 */
export function emittedPayloadKeys(record: Record<string, unknown> | undefined): readonly string[] {
  return Object.keys(record ?? {})
    .filter((key) => !PIPELINE_KEYS.has(key))
    .sort();
}
