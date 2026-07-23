import CoreDomain
import GRDB

/// Local media transfer references — never the binary content itself.
///
/// Source: architecture/ios-application-design.md, section "13. Media
/// Transfer"; architecture/offline-synchronization.md, section "18. Media
/// Coordination".
public protocol MediaTransferStore: Sendable {
    func save(_ transfer: MediaTransfer) async throws

    func fetch(id: String) async throws -> MediaTransfer?

    /// Every transfer for one garden not yet in a terminal state
    /// (`retained` or `deleted`).
    func fetchPending(gardenId: String) async throws -> [MediaTransfer]
}

public struct GRDBMediaTransferStore: MediaTransferStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func save(_ transfer: MediaTransfer) async throws {
        try await dbQueue.write { db in
            try MediaTransferRecord(transfer).save(db)
        }
    }

    public func fetch(id: String) async throws -> MediaTransfer? {
        try await dbQueue.read { db in
            try MediaTransferRecord.fetchOne(db, key: id)?.domainValue
        }
    }

    public func fetchPending(gardenId: String) async throws -> [MediaTransfer] {
        let terminalStates = [MediaTransferState.retained.rawValue, MediaTransferState.deleted.rawValue]

        return try await dbQueue.read { db in
            try MediaTransferRecord
                .filter(Column("gardenId") == gardenId)
                .filter(!terminalStates.contains(Column("state")))
                .order(Column("createdAt"))
                .fetchAll(db)
                .compactMap(\.domainValue)
        }
    }
}
