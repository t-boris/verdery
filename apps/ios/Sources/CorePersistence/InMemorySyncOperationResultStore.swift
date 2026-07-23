import CoreDomain

/// Fallback and test double for `SyncOperationResultStore` — no GRDB, no disk
/// I/O.
public actor InMemorySyncOperationResultStore: SyncOperationResultStore {
    private var resultsByOperation: [String: SyncOperationResult] = [:]

    public init() {}

    public func record(_ result: SyncOperationResult) async throws {
        resultsByOperation[result.operationId] = result
    }

    public func result(forOperation operationId: String) async throws -> SyncOperationResult? {
        resultsByOperation[operationId]
    }

    public func fetchAll(gardenId: String) async throws -> [SyncOperationResult] {
        resultsByOperation.values
            .filter { $0.gardenId == gardenId }
            .sorted { $0.receivedAt > $1.receivedAt }
    }
}
