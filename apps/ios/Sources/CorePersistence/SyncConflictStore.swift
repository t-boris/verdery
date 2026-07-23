import CoreDomain
import Foundation
import GRDB

/// Durable same-object conflicts, kept until their resolution is accepted by
/// the server.
///
/// Source: architecture/offline-synchronization.md, section "15. Local
/// Conflict Recovery".
public protocol SyncConflictStore: Sendable {
    func record(_ conflict: SyncConflict) async throws

    /// Every unresolved conflict for one garden, oldest first.
    func fetchOpen(gardenId: String) async throws -> [SyncConflict]

    /// Marks a conflict resolved by a newly created outbox operation. The
    /// conflict row itself stays until a caller removes it, once that
    /// resolution operation is accepted — see `SyncConflictStore.remove(_:)`.
    func resolve(conflictId: String, resolutionOperationId: String, at date: Date) async throws

    func remove(conflictId: String) async throws
}

public struct GRDBSyncConflictStore: SyncConflictStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func record(_ conflict: SyncConflict) async throws {
        try await dbQueue.write { db in
            try SyncConflictRecord(conflict).save(db)
        }
    }

    public func fetchOpen(gardenId: String) async throws -> [SyncConflict] {
        try await dbQueue.read { db in
            try SyncConflictRecord
                .filter(Column("gardenId") == gardenId && Column("resolutionOperationId") == nil)
                .order(Column("createdAt"))
                .fetchAll(db)
                .map(\.domainValue)
        }
    }

    public func resolve(conflictId: String, resolutionOperationId: String, at date: Date) async throws {
        try await dbQueue.write { db in
            guard let record = try SyncConflictRecord.fetchOne(db, key: conflictId) else { return }
            let resolved = record.domainValue.resolving(withOperationId: resolutionOperationId, at: date)
            try SyncConflictRecord(resolved).update(db)
        }
    }

    public func remove(conflictId: String) async throws {
        try await dbQueue.write { db in
            _ = try SyncConflictRecord.deleteOne(db, key: conflictId)
        }
    }
}
