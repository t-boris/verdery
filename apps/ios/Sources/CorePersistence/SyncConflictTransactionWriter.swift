import CoreDomain
import Foundation
import GRDB

/// `Database`-parameter twin of `GRDBSyncConflictStore`'s own
/// `remove(conflictId:)`/`resolve(conflictId:resolutionOperationId:at:)` —
/// the same "callable from inside an already-open `dbQueue.write` block"
/// shape `SyncOutboxTransactionWriter` already establishes, extended to the
/// conflict store so `RemoteSyncEngine+ConflictResolution.swift`'s recovery
/// paths can commit an outbox write and a conflict write together. See
/// `SyncTransactionContext`'s own doc comment for the full reasoning this
/// mirrors from `GRDBGardenStore.commitOfflineMutation` (Stage 4a).
public enum SyncConflictTransactionWriter {
    public static func remove(conflictId: String, in db: Database) throws {
        _ = try SyncConflictRecord.deleteOne(db, key: conflictId)
    }

    public static func resolve(conflictId: String, resolutionOperationId: String, at date: Date, in db: Database) throws {
        guard let record = try SyncConflictRecord.fetchOne(db, key: conflictId) else { return }
        let resolved = record.domainValue.resolving(withOperationId: resolutionOperationId, at: date)
        try SyncConflictRecord(resolved).update(db)
    }
}
