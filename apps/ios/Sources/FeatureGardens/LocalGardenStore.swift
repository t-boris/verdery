import CoreDomain
import GRDB

/// The local read model: what the garden list shows before, or in place of,
/// a completed network request.
public protocol LocalGardenStore: Sendable {
    func fetchAll() async throws -> [Garden]
    func replaceAll(with gardens: [Garden]) async throws
    func save(_ garden: Garden) async throws
}

public struct GRDBGardenStore: LocalGardenStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func fetchAll() async throws -> [Garden] {
        try await dbQueue.read { db in
            try GardenRecord
                .order(Column("createdAt").desc)
                .fetchAll(db)
                .compactMap(\.domainValue)
        }
    }

    /// Replaces the whole cache with one server-confirmed page.
    ///
    /// Correct as long as this client only ever fetches the single default
    /// page — see `GardensListViewModel`. A client that paginates would need
    /// to merge instead of replace.
    public func replaceAll(with gardens: [Garden]) async throws {
        try await dbQueue.write { db in
            try GardenRecord.deleteAll(db)
            for garden in gardens {
                try GardenRecord(garden).insert(db)
            }
        }
    }

    public func save(_ garden: Garden) async throws {
        try await dbQueue.write { db in
            try GardenRecord(garden).save(db)
        }
    }
}
