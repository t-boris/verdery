import CoreDomain
import GRDB

/// The most recently known outcome for each pushed outbox operation.
///
/// Source: architecture/offline-synchronization.md, section "8. Push
/// Protocol".
public protocol SyncOperationResultStore: Sendable {
    /// Upserts the latest known outcome for one operation, replacing any
    /// prior result for the same `operationId` — matching the server's own
    /// idempotent-outcome guarantee (section "9. Server Idempotency").
    func record(_ result: SyncOperationResult) async throws

    func result(forOperation operationId: String) async throws -> SyncOperationResult?

    /// Every recorded outcome for one garden, most recently received first.
    func fetchAll(gardenId: String) async throws -> [SyncOperationResult]
}

public struct GRDBSyncOperationResultStore: SyncOperationResultStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func record(_ result: SyncOperationResult) async throws {
        try await dbQueue.write { db in
            try SyncOperationResultRecord(result).save(db)
        }
    }

    public func result(forOperation operationId: String) async throws -> SyncOperationResult? {
        try await dbQueue.read { db in
            try SyncOperationResultRecord.fetchOne(db, key: operationId)?.domainValue
        }
    }

    public func fetchAll(gardenId: String) async throws -> [SyncOperationResult] {
        try await dbQueue.read { db in
            try SyncOperationResultRecord
                .filter(Column("gardenId") == gardenId)
                .order(Column("receivedAt").desc)
                .fetchAll(db)
                .compactMap(\.domainValue)
        }
    }
}
