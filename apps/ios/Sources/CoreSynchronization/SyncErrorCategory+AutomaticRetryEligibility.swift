import CoreDomain

/// Whether a failure classified as this category may be retried
/// automatically — the backoff-driven kind `RemoteSyncEngine.pushPending()`
/// offers on its own, as opposed to an explicit user-initiated retry
/// (`RemoteSyncEngine.retryNow()`).
///
/// architecture/offline-synchronization.md, section "20. Connectivity and
/// Backoff": "Authentication, authorization, validation, and conflict
/// failures do not retry automatically as transient failures." Read
/// precisely, not loosely: the document names exactly four categories as
/// excluded from AUTOMATIC retry — it does not say "never retry", so a
/// user-initiated retry may still attempt any of them (see `retryNow()`'s own
/// doc comment). `.connectivity`/`.server` are the genuinely transient
/// categories the document's own implication ("...as transient failures")
/// leaves eligible. `.unknown` (an undecodable/unexpected response —
/// `APIGatewayError+SyncErrorCategory.swift`'s own doc comment: "a contract
/// violation, not something the user or a retry can fix") is not one of the
/// document's four named exclusions either, so it stays eligible here too,
/// matching the document's own wording exactly rather than a broader
/// "anything that isn't obviously transient" reading this stage was not
/// asked to adopt.
///
/// Lives in `CoreSynchronization`, not `CoreDomain`: the same "only
/// synchronization code needs this classification vocabulary" reasoning
/// `APIGatewayError+SyncErrorCategory.swift`'s own doc comment already gives
/// for keeping `SyncErrorCategory`'s OWN classification out of
/// `CoreNetworking` — this is a second, retry-policy-specific classification
/// of the same enum, equally specific to synchronization.
extension SyncErrorCategory {
    var isEligibleForAutomaticRetry: Bool {
        switch self {
        case .authentication, .authorization, .validation, .conflict:
            false
        case .connectivity, .server, .unknown:
            true
        }
    }
}
