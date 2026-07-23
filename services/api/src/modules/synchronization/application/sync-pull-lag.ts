/**
 * Pull-lag proxy for one `GET /sync/changes` page.
 *
 * "Pull lag" (architecture/observability-and-analytics.md, section
 * "7. Service Metrics" → "Synchronization": "Pull lag and cursor-expiration
 * rate") is not one single well-defined quantity — this picks the one that is
 * real and computable purely from data this endpoint already fetches, without
 * an extra query: **how long ago the most recent change on the page was
 * committed, relative to when the page is served.** A page with a
 * consistently large value means clients are pulling changes long after they
 * happened (a slow or infrequent pull cadence); a page with a small value
 * means clients are staying close to real time. This is deliberately not
 * "how far behind is this client's cursor from the current head of history",
 * which would need a second query against `platform.sync_change` this
 * endpoint has no other reason to run.
 *
 * `now` is the same instant `GetSyncChanges.execute()` already stamped into
 * `nextCursor.issuedAt` (see `sync-changes-cursor.ts`), not a fresh
 * `Date.now()` read at the transport layer — reusing it keeps this proxy
 * exact against the one `Clock` the application layer actually used, rather
 * than introducing a second, slightly-later wall-clock read.
 */

export interface PulledChangeCommittedAt {
  readonly committedAt: string;
}

/**
 * `undefined` when the page is empty (nothing pulled, so no lag to report —
 * the client is caught up as of this cursor) rather than `0`, which would
 * misleadingly read as "perfectly fresh."
 */
export function computePullLagMilliseconds(
  items: readonly PulledChangeCommittedAt[],
  now: Date,
): number | undefined {
  const last = items.at(-1);
  if (last === undefined) {
    return undefined;
  }

  return Math.max(0, now.getTime() - new Date(last.committedAt).getTime());
}
