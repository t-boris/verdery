import Foundation

/// One way a user may recover from a same-object conflict.
///
/// Source: architecture/offline-synchronization.md, section "14.5 Geometry"
/// enumerates these four for geometry specifically ("Keep the server
/// version", "Reapply the local intent to the current version...", "Open
/// both versions for manual review", "Duplicate as a new object..."); this
/// client generalizes the same four across every conflict category in
/// section 14, since a conflict record only ever suggests recovery actions
/// that are actually offered, never presents one the current conflict
/// category cannot support.
public enum ConflictRecoveryAction: String, Equatable, Sendable, CaseIterable, Codable {
    case keepServerVersion
    case reapplyLocalIntent
    case openForManualReview
    case duplicateAsNewObject
}

/// A durable record of a same-object conflict, kept until its resolution is
/// accepted by the server.
///
/// Source: architecture/offline-synchronization.md, section "15. Local
/// Conflict Recovery": "Original operation. Local optimistic representation.
/// Current server representation or authorized summary. Conflict code.
/// Suggested recovery actions. Resolution operation when selected."
public struct SyncConflict: Equatable, Sendable, Identifiable, Codable {
    /// The conflict record's own ID, distinct from `originalOperationId`: a
    /// resolution attempt can itself conflict again, and the prior conflict
    /// record must stay addressable while that happens (section 15:
    /// "Resolving a conflict creates a new outbox command and closes the
    /// prior conflict only after the resolution is accepted").
    public let id: String
    public let originalOperationId: String
    public let gardenId: String
    /// The `SyncRecordType` wire value this conflict's record belongs to —
    /// `"garden"`, `"gardenObject"`, `"plant"`, `"observation"`, or `"task"`,
    /// copied verbatim from the push outcome's own `currentRecordType`
    /// (`CoreNetworking.SyncPushOperationOutcome.conflict`) at the moment the
    /// conflict was recorded. Added for P5-CONFLICT-01: the resolution
    /// mechanism needs this to look up the right `CoreSynchronization
    /// .SyncRecordApplier` generically, without re-parsing
    /// `serverRepresentation`'s own envelope every time. A plain `String`,
    /// matching `SyncRecordApplier.recordType`'s own reasoning for staying
    /// unenumerated.
    public let recordType: String
    /// A stable conflict type (section "14.2 Same Mutable Object": "a stable
    /// conflict type"), e.g. `"staleRevision"` or `"taskAlreadySuperseded"`.
    /// Not an enum here: this client's conflict vocabulary is not yet pinned
    /// to a contract schema the way `CoreNetworking.SharedErrorCode` is
    /// pinned to `packages/api-contracts`'s `SharedErrorCode` — introducing
    /// an enum ahead of that contract would risk this client silently
    /// failing to recognize a real conflict code it has not yet special-
    /// cased. `conflictCode` becomes an enum once the sync push contract
    /// (a later stage) fixes its value set.
    public let conflictCode: String
    /// The user's local optimistic representation at the time of conflict,
    /// JSON-encoded and opaque to this layer.
    public let localRepresentation: String
    /// The current server representation, or an authorized summary of it,
    /// JSON-encoded and opaque to this layer.
    public let serverRepresentation: String
    public let suggestedRecoveryActions: [ConflictRecoveryAction]
    /// Set once the user has chosen a recovery action and a new outbox
    /// operation has been created for it. The conflict record itself is only
    /// removed after that resolution operation is accepted by the server.
    public let resolutionOperationId: String?
    public let createdAt: Date
    public let resolvedAt: Date?

    public init(
        id: String,
        originalOperationId: String,
        gardenId: String,
        recordType: String,
        conflictCode: String,
        localRepresentation: String,
        serverRepresentation: String,
        suggestedRecoveryActions: [ConflictRecoveryAction],
        resolutionOperationId: String? = nil,
        createdAt: Date,
        resolvedAt: Date? = nil
    ) {
        self.id = id
        self.originalOperationId = originalOperationId
        self.gardenId = gardenId
        self.recordType = recordType
        self.conflictCode = conflictCode
        self.localRepresentation = localRepresentation
        self.serverRepresentation = serverRepresentation
        self.suggestedRecoveryActions = suggestedRecoveryActions
        self.resolutionOperationId = resolutionOperationId
        self.createdAt = createdAt
        self.resolvedAt = resolvedAt
    }

    public var isResolved: Bool { resolutionOperationId != nil }

    /// The same conflict, marked resolved by a new outbox operation.
    ///
    /// Source: architecture/offline-synchronization.md, section "15. Local
    /// Conflict Recovery" ("Resolving a conflict creates a new outbox
    /// command and closes the prior conflict only after the resolution is
    /// accepted").
    public func resolving(withOperationId operationId: String, at date: Date) -> SyncConflict {
        SyncConflict(
            id: id,
            originalOperationId: originalOperationId,
            gardenId: gardenId,
            recordType: recordType,
            conflictCode: conflictCode,
            localRepresentation: localRepresentation,
            serverRepresentation: serverRepresentation,
            suggestedRecoveryActions: suggestedRecoveryActions,
            resolutionOperationId: operationId,
            createdAt: createdAt,
            resolvedAt: date
        )
    }
}
