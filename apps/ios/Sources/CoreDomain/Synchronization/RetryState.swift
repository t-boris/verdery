import Foundation

/// Classifies why an outbox operation's or media transfer's most recent
/// attempt did not fully succeed.
///
/// Mirrors how `CoreNetworking.APIGatewayError` classifies a single failed
/// request, but this classification is persisted rather than thrown and
/// caught: it must survive process termination so a future synchronization
/// engine (`CoreSynchronization`) can decide whether to retry automatically
/// or surface the failure to the user.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation" ("Retry state and last error category").
public enum SyncErrorCategory: String, Equatable, Sendable, CaseIterable, Codable {
    case validation
    case authentication
    case authorization
    case connectivity
    case conflict
    case server
    case unknown
}

/// How many times a local operation or media transfer has been attempted
/// against the server, and what happened last time.
///
/// Shared shape for `OutboxOperation` and `MediaTransfer`: both are retried
/// independently of each other (architecture/offline-synchronization.md,
/// section "18. Media Coordination": "Media upload retry and sync retry are
/// separately observable"), but "how many times, and why did it last fail"
/// is identical for both.
public struct RetryState: Equatable, Sendable, Codable {
    public let attemptCount: Int
    public let lastAttemptedAt: Date?
    public let lastErrorCategory: SyncErrorCategory?

    public init(
        attemptCount: Int = 0,
        lastAttemptedAt: Date? = nil,
        lastErrorCategory: SyncErrorCategory? = nil
    ) {
        self.attemptCount = attemptCount
        self.lastAttemptedAt = lastAttemptedAt
        self.lastErrorCategory = lastErrorCategory
    }

    /// A new state reflecting one more attempt.
    public func recordingAttempt(errorCategory: SyncErrorCategory?, at date: Date) -> RetryState {
        RetryState(attemptCount: attemptCount + 1, lastAttemptedAt: date, lastErrorCategory: errorCategory)
    }
}
