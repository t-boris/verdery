import CoreDomain
import Foundation
import GRDB

/// The local outbox: pending mutations queued for a future push, and their
/// durable record until an accepted outcome is known.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation".
public protocol SyncOutboxStore: Sendable {
    /// Persists a new outbox operation, assigning its local processing
    /// order, and returns the persisted operation.
    @discardableResult
    func enqueue(_ operation: OutboxOperation) async throws -> OutboxOperation

    /// Every operation for one garden, oldest local processing order first.
    func fetchPending(gardenId: String) async throws -> [OutboxOperation]

    /// Every operation across every garden, oldest local processing order
    /// first — the order a push batch must preserve (architecture/offline-
    /// synchronization.md, section "16. Ordering").
    func fetchAll() async throws -> [OutboxOperation]

    /// Records one more push attempt against an operation.
    func recordAttempt(operationId: String, errorCategory: SyncErrorCategory?, at date: Date) async throws

    /// Removes an operation once its outcome is durably resolved: accepted,
    /// or a terminal rejection the user has acknowledged.
    func remove(operationId: String) async throws
}

public struct GRDBSyncOutboxStore: SyncOutboxStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    @discardableResult
    public func enqueue(_ operation: OutboxOperation) async throws -> OutboxOperation {
        try await dbQueue.write { db in
            // Serialized by GRDB's writer queue: no two `enqueue` calls on
            // this `dbQueue` observe the same `MAX(localSequence)`.
            let nextSequence = try Int64.fetchOne(
                db,
                sql: "SELECT COALESCE(MAX(localSequence), 0) + 1 FROM sync_outbox"
            ) ?? 1
            let assigned = operation.assigningLocalSequence(nextSequence)
            try OutboxOperationRecord(assigned).insert(db)
            return assigned
        }
    }

    public func fetchPending(gardenId: String) async throws -> [OutboxOperation] {
        try await dbQueue.read { db in
            try OutboxOperationRecord
                .filter(Column("gardenId") == gardenId)
                .order(Column("localSequence"))
                .fetchAll(db)
                .map(\.domainValue)
        }
    }

    public func fetchAll() async throws -> [OutboxOperation] {
        try await dbQueue.read { db in
            try OutboxOperationRecord
                .order(Column("localSequence"))
                .fetchAll(db)
                .map(\.domainValue)
        }
    }

    public func recordAttempt(operationId: String, errorCategory: SyncErrorCategory?, at date: Date) async throws {
        try await dbQueue.write { db in
            guard let record = try OutboxOperationRecord.fetchOne(db, key: operationId) else { return }
            let updated = record.domainValue.recordingAttempt(errorCategory: errorCategory, at: date)
            try OutboxOperationRecord(updated).update(db)
        }
    }

    public func remove(operationId: String) async throws {
        try await dbQueue.write { db in
            _ = try OutboxOperationRecord.deleteOne(db, key: operationId)
        }
    }
}
