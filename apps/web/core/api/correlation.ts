/**
 * Header carrying the client-generated correlation identifier.
 *
 * The identifier lets one user-visible workflow be followed through server
 * telemetry without logging any of its content, so it is attached to every
 * request rather than only to the ones that fail.
 *
 * Source: architecture/observability-and-analytics.md, section "4. Correlation".
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Creates an identifier for one request. Opaque, random, and free of user content. */
export function createCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}
