import CoreDomain
import Foundation
import GRDB

/// The durable pull cursor, one per garden partition.
///
/// Source: architecture/offline-synchronization.md, section "10. Pull
/// Protocol".
public protocol SyncCursorStore: Sendable {
    func cursor(forGarden gardenId: String) async throws -> SyncCursor?

    /// Advances (or creates) the cursor for one garden. Called in the same
    /// local transaction that applies the page the new cursor value came
    /// with — see section "10. Pull Protocol": "The client applies each page
    /// in one SQLite transaction and advances the cursor only in that same
    /// transaction." Composing that transaction is a future sync engine's
    /// job; this store only guarantees the write itself is atomic.
    func advance(gardenId: String, cursor: String, at date: Date) async throws

    /// Clears the durable cursor for one garden — full resynchronization,
    /// section "13. Full Resynchronization".
    func reset(gardenId: String) async throws
}

public struct GRDBSyncCursorStore: SyncCursorStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func cursor(forGarden gardenId: String) async throws -> SyncCursor? {
        try await dbQueue.read { db in
            try SyncCursorRecord.fetchOne(db, key: gardenId)?.domainValue
        }
    }

    public func advance(gardenId: String, cursor: String, at date: Date) async throws {
        try await dbQueue.write { db in
            try SyncCursorRecord(SyncCursor(gardenId: gardenId, cursor: cursor, updatedAt: date)).save(db)
        }
    }

    public func reset(gardenId: String) async throws {
        try await dbQueue.write { db in
            _ = try SyncCursorRecord.deleteOne(db, key: gardenId)
        }
    }
}
