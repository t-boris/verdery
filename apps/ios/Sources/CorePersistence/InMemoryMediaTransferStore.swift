import CoreDomain

/// Fallback and test double for `MediaTransferStore` — no GRDB, no disk I/O.
public actor InMemoryMediaTransferStore: MediaTransferStore {
    private var transfersById: [String: MediaTransfer] = [:]

    public init() {}

    public func save(_ transfer: MediaTransfer) async throws {
        transfersById[transfer.id] = transfer
    }

    public func fetch(id: String) async throws -> MediaTransfer? {
        transfersById[id]
    }

    public func fetchPending(gardenId: String) async throws -> [MediaTransfer] {
        transfersById.values
            .filter { $0.gardenId == gardenId && $0.state != .retained && $0.state != .deleted }
            .sorted { $0.createdAt < $1.createdAt }
    }
}
