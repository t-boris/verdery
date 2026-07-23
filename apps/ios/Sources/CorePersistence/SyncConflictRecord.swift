import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for `sync_conflict`.
///
/// Source: architecture/offline-synchronization.md, section "15. Local
/// Conflict Recovery".
struct SyncConflictRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "sync_conflict"

    let id: String
    let originalOperationId: String
    let gardenId: String
    let conflictCode: String
    let localRepresentation: String
    let serverRepresentation: String
    let suggestedRecoveryActions: String
    let resolutionOperationId: String?
    let createdAt: Date
    let resolvedAt: Date?
}

extension SyncConflictRecord {
    init(_ conflict: SyncConflict) {
        self.id = conflict.id
        self.originalOperationId = conflict.originalOperationId
        self.gardenId = conflict.gardenId
        self.conflictCode = conflict.conflictCode
        self.localRepresentation = conflict.localRepresentation
        self.serverRepresentation = conflict.serverRepresentation
        self.suggestedRecoveryActions = JSONColumnCoding.encode(conflict.suggestedRecoveryActions.map(\.rawValue))
        self.resolutionOperationId = conflict.resolutionOperationId
        self.createdAt = conflict.createdAt
        self.resolvedAt = conflict.resolvedAt
    }

    var domainValue: SyncConflict {
        SyncConflict(
            id: id,
            originalOperationId: originalOperationId,
            gardenId: gardenId,
            conflictCode: conflictCode,
            localRepresentation: localRepresentation,
            serverRepresentation: serverRepresentation,
            suggestedRecoveryActions: JSONColumnCoding.decode(suggestedRecoveryActions)
                .compactMap(ConflictRecoveryAction.init(rawValue:)),
            resolutionOperationId: resolutionOperationId,
            createdAt: createdAt,
            resolvedAt: resolvedAt
        )
    }
}
