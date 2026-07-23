import Foundation

/// Exponential backoff with full jitter — architecture/offline-
/// synchronization.md, section "20. Connectivity and Backoff": "Retry uses
/// exponential backoff with jitter."
///
/// "Full jitter" (`delay = random(0, min(maxDelaySeconds, baseDelaySeconds *
/// 2^(attemptCount - 1)))`) rather than a fixed multiplier or a fraction-of-
/// the-exponential jitter: it is the simplest of the three strategies AWS's
/// own "Exponential Backoff And Jitter" analysis found strictly best at
/// avoiding synchronized retry storms across many independent clients, and
/// this codebase has no reason to need a narrower jitter band than that.
///
/// `baseDelaySeconds`/`maxDelaySeconds` are this module's own reasoned
/// defaults, not a number the architecture document names — matching the
/// precedent `services/api/src/modules/synchronization/application/
/// sync-changes-cursor.ts`'s own `SYNC_CHANGES_RETENTION_MILLISECONDS`
/// comment sets ("this module's own reasoned default... not a documented
/// architecture requirement") and `sync-push-idempotency.ts`'s identical
/// `SYNC_PUSH_TTL_MILLISECONDS` precedent before it:
///
/// - `baseDelaySeconds = 2`: long enough that an immediately-retried
///   transient blip (a dropped packet, a momentary `503`) does not turn into
///   a tight retry loop, short enough that a real user tapping an explicit
///   retry affordance a few seconds later is never blocked by it — explicit
///   retry (`RemoteSyncEngine.retryNow()`) always bypasses this gate anyway
///   (see that method's own doc comment), so this number only governs
///   *automatic* re-attempts.
/// - `maxDelaySeconds = 300` (5 minutes): bounds the worst case for a
///   foregrounded app that keeps triggering sync (scene-phase transitions,
///   local outbox inserts) through a sustained outage to "at most a few
///   minutes between attempts" — long enough to stop hammering a genuinely
///   degraded service, short enough that a session lasting the length of a
///   typical gardening visit still gets several automatic retries rather
///   than effectively giving up for the day.
public enum SyncBackoff {
    public static let baseDelaySeconds: TimeInterval = 2
    public static let maxDelaySeconds: TimeInterval = 300

    /// The delay to wait before the next automatic attempt, after
    /// `attemptCount` consecutive transient failures. `attemptCount <= 0`
    /// (never attempted, or a defensive negative) is always eligible
    /// immediately.
    ///
    /// - Parameter randomUnitInterval: A source of values in `0..<1`,
    ///   injected for deterministic tests — the same `now: @Sendable () ->
    ///   Date` injection pattern `RemoteSyncEngine`/every `FeatureGardens`
    ///   use case already uses for `Date.init`, applied to `Double.random`
    ///   instead.
    public static func delay(
        forAttempt attemptCount: Int,
        randomUnitInterval: () -> Double
    ) -> TimeInterval {
        guard attemptCount > 0 else { return 0 }

        let exponential = baseDelaySeconds * pow(2, Double(attemptCount - 1))
        let cap = min(maxDelaySeconds, exponential)
        return cap * randomUnitInterval()
    }

    /// Whether an operation last attempted at `lastAttemptedAt`, `attemptCount`
    /// times, may be retried automatically as of `now` — the gate
    /// `RemoteSyncEngine.pushPending()` applies before including a pending
    /// operation in its next batch, and `RemoteSyncEngine.pullChanges()`
    /// applies before starting its next cycle.
    ///
    /// - Parameter retryAfter: The server's own `Retry-After` header value
    ///   (`CoreNetworking.APIGatewayError.retryAfterSeconds`), when the most
    ///   recent failure carried one — authoritative over the computed
    ///   exponential delay when present and larger, never used to shorten it
    ///   (a server-directed wait is a floor, not a ceiling override).
    public static func isEligible(
        attemptCount: Int,
        lastAttemptedAt: Date?,
        retryAfter: TimeInterval? = nil,
        now: Date,
        randomUnitInterval: () -> Double
    ) -> Bool {
        guard let lastAttemptedAt, attemptCount > 0 else { return true }

        let computed = delay(forAttempt: attemptCount, randomUnitInterval: randomUnitInterval)
        let effective = max(computed, retryAfter ?? 0)
        return now >= lastAttemptedAt.addingTimeInterval(effective)
    }
}
