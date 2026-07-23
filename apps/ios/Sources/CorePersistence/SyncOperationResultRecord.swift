import CoreDomain
import Foundation
import GRDB

/// GRDB row shape for `sync_operation_result`.
///
/// Source: architecture/offline-synchronization.md, section "8. Push
/// Protocol".
struct SyncOperationResultRecord: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "sync_operation_result"

    let operationId: String
    let gardenId: String
    let outcome: String
    let serverRevision: Int?
    let conflictId: String?
    let detail: String?
    let receivedAt: Date
}

extension SyncOperationResultRecord {
    init(_ result: SyncOperationResult) {
        self.operationId = result.operationId
        self.gardenId = result.gardenId
        self.outcome = result.outcome.rawValue
        self.serverRevision = result.serverRevision
        self.conflictId = result.conflictId
        self.detail = result.detail
        self.receivedAt = result.receivedAt
    }

    var domainValue: SyncOperationResult? {
        guard let outcome = SyncOperationOutcome(rawValue: outcome) else { return nil }

        return SyncOperationResult(
            operationId: operationId,
            gardenId: gardenId,
            outcome: outcome,
            serverRevision: serverRevision,
            conflictId: conflictId,
            detail: detail,
            receivedAt: receivedAt
        )
    }
}
