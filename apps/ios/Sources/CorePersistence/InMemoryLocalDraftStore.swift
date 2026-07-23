import CoreDomain

/// Fallback and test double for `LocalDraftStore` — no GRDB, no disk I/O.
public actor InMemoryLocalDraftStore: LocalDraftStore {
    private var draftsById: [String: LocalDraft] = [:]

    public init() {}

    public func save(_ draft: LocalDraft) async throws {
        draftsById[draft.id] = draft
    }

    public func fetch(id: String) async throws -> LocalDraft? {
        draftsById[id]
    }

    public func fetchAll(profileId: String, gardenId: String?) async throws -> [LocalDraft] {
        draftsById.values
            .filter { $0.profileId == profileId && (gardenId == nil || $0.gardenId == gardenId) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    public func delete(id: String) async throws {
        draftsById[id] = nil
    }
}
