import Foundation

/// Every outcome the server may report for one pushed outbox operation.
///
/// Source: architecture/offline-synchronization.md, section "8. Push
/// Protocol".
public enum SyncOperationOutcome: String, Equatable, Sendable, CaseIterable, Codable {
    case accepted
    case duplicate
    case conflict
    case rejected
    case blockedByDependency
    case retryLater
}

/// The most recently known outcome for one outbox operation.
///
/// Keyed by `operationId` rather than carrying a separate identifier: a
/// later push result for the same operation ID replaces the prior one,
/// matching the server's own idempotent-outcome guarantee (section
/// "9. Server Idempotency": "The server persists the stable outcome").
///
/// Source: architecture/offline-synchronization.md, section "8. Push
/// Protocol".
public struct SyncOperationResult: Equatable, Sendable, Codable {
    public let operationId: String
    public let gardenId: String
    public let outcome: SyncOperationOutcome
    /// The authoritative record revision the response carried, when the
    /// outcome supplies one — section "8. Push Protocol": "The response
    /// includes authoritative record revisions or references needed to
    /// update the local projection."
    public let serverRevision: Int?
    /// Set when `outcome == .conflict`, linking to the `SyncConflict` record
    /// carrying the full detail.
    public let conflictId: String?
    /// A short, redaction-safe outcome detail — never a raw provider
    /// response or payload, per architecture/ios-application-design.md,
    /// section "16. Error Handling".
    public let detail: String?
    public let receivedAt: Date

    public init(
        operationId: String,
        gardenId: String,
        outcome: SyncOperationOutcome,
        serverRevision: Int? = nil,
        conflictId: String? = nil,
        detail: String? = nil,
        receivedAt: Date
    ) {
        self.operationId = operationId
        self.gardenId = gardenId
        self.outcome = outcome
        self.serverRevision = serverRevision
        self.conflictId = conflictId
        self.detail = detail
        self.receivedAt = receivedAt
    }
}
