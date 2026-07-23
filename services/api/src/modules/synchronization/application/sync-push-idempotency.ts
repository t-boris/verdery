/**
 * The operation-id idempotency layer `PushSyncOperations` and
 * `AcknowledgeSyncOperations` share, built directly on the existing
 * `platform.idempotency_record` table/`IdempotencyStore` port rather than a
 * new table.
 *
 * Why reuse, not build new: `IdempotencyStore`'s existing shape —
 * `(actorProfileId, operation, idempotencyKey)` primary key,
 * `requestFingerprint` mismatch throwing `ConflictError`
 * (`request.idempotency.key_reused`) — is *exactly* section "9. Server
 * Idempotency"'s own two rules ("A duplicate identical operation returns
 * the prior outcome" / "Reusing an operation ID with another payload is
 * rejected") with no new mechanism needed: `operation` here is the fixed
 * constant `SYNC_PUSH_OPERATION` (not each command's own `'gardens.create'`-
 * style constant — see `route-garden-operation.ts`'s header comment for that
 * *separate*, orthogonal reuse of `operationId` as each sibling command's
 * own internal idempotency key), `idempotencyKey` is the wire `operationId`,
 * and `requestFingerprint` is the operation's canonical payload.
 *
 * The one real gap this reuse needed: `check()` has no fingerprint-
 * independent pure lookup, which `AcknowledgeSyncOperations` needs (an
 * operation id with no payload to fingerprint against). Resolved by adding
 * `IdempotencyStore.lookup()` — a narrow, additive, read-only method on the
 * shared port (`platform/idempotency/idempotency-store.ts`), not a
 * module-local query bypassing that abstraction, since a pure lookup by key
 * is generic platform behavior other future callers may equally want.
 *
 * TTL: `SYNC_PUSH_TTL_MILLISECONDS` is a deliberately different, much longer
 * figure than the `24 * 60 * 60 * 1000` (24 hours) every sibling module's own
 * `run-idempotent-command.ts` uses for ordinary same-session REST retries.
 * An outbox operation is not an ordinary retry: architecture/
 * offline-synchronization.md documents a client that may stay offline for an
 * extended period before it ever gets to push, and its operation ID must
 * still be replayable/acknowledgeable once it does. Section "17. Deletion
 * and Tombstones" names the closest steer this repository's architecture
 * gives — "maximum supported offline duration" — but does not name a number.
 * **30 days is this module's own reasoned default, not a documented
 * architecture requirement**: long enough to comfortably cover a realistic
 * extended offline period (a multi-week trip, a lapsed app open habit) while
 * still bounding how long `platform.idempotency_record` accumulates rows for
 * (no cleanup job exists yet — see that table's own migration comment).
 * Revisit this figure once a real maximum-offline-duration number is
 * decided elsewhere, or once a cleanup job exists and this stops being the
 * only bound on the table's size.
 *
 * What is — and is not — persisted through this mechanism:
 * `accepted`/`rejected`/`conflict` are durable, stable outcomes and are
 * saved here; a retry of the identical operation ID and payload must
 * deterministically replay the same one (`SyncDuplicateOperationResult`'s
 * own description: only a previously `accepted` operation needs the
 * distinct `duplicate` label — `rejected`/`conflict` replay as themselves,
 * unchanged). `blockedByDependency` and `retryLater` are deliberately never
 * saved here: both are inherently transient, batch-composition- or
 * condition-dependent facts about *this attempt*, not the operation's own
 * final durable outcome — `SyncRetryLaterOperationResult`'s own description
 * ("safe for the client to retry with the identical operation ID and
 * payload") only makes sense if a retry is *not* guaranteed to replay the
 * same transient result. A subsequent retry of a previously
 * `blockedByDependency`/`retryLater` operation therefore always re-attempts
 * routing rather than replaying a cached transient result — see
 * `push-sync-operations.ts`.
 */

export const SYNC_PUSH_OPERATION = 'sync.push';

const DAYS = 24 * 60 * 60 * 1000;
export const SYNC_PUSH_TTL_MILLISECONDS = 30 * DAYS;

/** Canonical fingerprint for one operation's payload — the "another payload" section 9 checks a reused operation ID against. */
export function fingerprintOperationPayload(payload: unknown): string {
  return JSON.stringify(payload);
}
