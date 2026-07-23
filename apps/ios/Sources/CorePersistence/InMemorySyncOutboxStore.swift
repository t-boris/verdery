import CoreDomain
import Foundation

/// Fallback and test double for `SyncOutboxStore` — no GRDB, no disk I/O.
///
/// Mirrors `FeatureGardens.InMemoryGardenStore`'s role: the store a caller
/// falls back to when `LocalDatabase.open` throws, and the double most of
/// this package's own tests exercise the outbox contract against without a
/// real SQLite file.
public actor InMemorySyncOutboxStore: SyncOutboxStore {
    private var operationsById: [String: OutboxOperation] = [:]
    private var nextSequence: Int64 = 1

    public init() {}

    @discardableResult
    public func enqueue(_ operation: OutboxOperation) async throws -> OutboxOperation {
        let assigned = operation.assigningLocalSequence(nextSequence)
        nextSequence += 1
        operationsById[assigned.id] = assigned
        return assigned
    }

    public func fetchPending(gardenId: String) async throws -> [OutboxOperation] {
        operationsById.values
            .filter { $0.gardenId == gardenId }
            .sorted { ($0.localSequence ?? 0) < ($1.localSequence ?? 0) }
    }

    public func fetchAll() async throws -> [OutboxOperation] {
        operationsById.values.sorted { ($0.localSequence ?? 0) < ($1.localSequence ?? 0) }
    }

    public func recordAttempt(operationId: String, errorCategory: SyncErrorCategory?, at date: Date) async throws {
        guard let operation = operationsById[operationId] else { return }
        operationsById[operationId] = operation.recordingAttempt(errorCategory: errorCategory, at: date)
    }

    public func remove(operationId: String) async throws {
        operationsById[operationId] = nil
    }
}
