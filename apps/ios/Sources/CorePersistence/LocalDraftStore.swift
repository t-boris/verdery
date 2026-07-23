import CoreDomain
import GRDB

/// Local-only, never-synchronized draft state.
///
/// Source: architecture/ios-application-design.md, section "7. Local
/// Persistence" ("Local-only drafts").
public protocol LocalDraftStore: Sendable {
    func save(_ draft: LocalDraft) async throws

    func fetch(id: String) async throws -> LocalDraft?

    /// Every draft for one profile, optionally narrowed to one garden,
    /// most recently updated first.
    func fetchAll(profileId: String, gardenId: String?) async throws -> [LocalDraft]

    func delete(id: String) async throws
}

public struct GRDBLocalDraftStore: LocalDraftStore {
    private let dbQueue: DatabaseQueue

    public init(dbQueue: DatabaseQueue) {
        self.dbQueue = dbQueue
    }

    public func save(_ draft: LocalDraft) async throws {
        try await dbQueue.write { db in
            try LocalDraftRecord(draft).save(db)
        }
    }

    public func fetch(id: String) async throws -> LocalDraft? {
        try await dbQueue.read { db in
            try LocalDraftRecord.fetchOne(db, key: id)?.domainValue
        }
    }

    public func fetchAll(profileId: String, gardenId: String?) async throws -> [LocalDraft] {
        try await dbQueue.read { db in
            var request = LocalDraftRecord.filter(Column("profileId") == profileId)
            if let gardenId {
                request = request.filter(Column("gardenId") == gardenId)
            }
            return try request
                .order(Column("updatedAt").desc)
                .fetchAll(db)
                .map(\.domainValue)
        }
    }

    public func delete(id: String) async throws {
        try await dbQueue.write { db in
            _ = try LocalDraftRecord.deleteOne(db, key: id)
        }
    }
}
