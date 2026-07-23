import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

@Suite("Local draft store")
struct LocalDraftStoreTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func draft(
        id: String = "draft-1",
        profileId: String = "profile-1",
        gardenId: String? = "garden-1",
        updatedAt: Date = Date(timeIntervalSince1970: 0)
    ) -> LocalDraft {
        LocalDraft(
            id: id,
            profileId: profileId,
            gardenId: gardenId,
            draftType: "mapObjectEdit",
            schemaVersion: 1,
            payload: #"{"label":"Draft"}"#,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: updatedAt
        )
    }

    @Test("save then fetch round-trips every field, including a nil garden")
    func saveRoundTripsFieldsIncludingNilGarden() async throws {
        let store = GRDBLocalDraftStore(dbQueue: try makeDatabase())
        let saved = draft(gardenId: nil)

        try await store.save(saved)

        let fetched = try await store.fetch(id: "draft-1")
        #expect(fetched == saved)
    }

    @Test("fetchAll scopes by profile and, optionally, garden")
    func fetchAllScopesByProfileAndGarden() async throws {
        let store = GRDBLocalDraftStore(dbQueue: try makeDatabase())
        try await store.save(draft(id: "draft-a", profileId: "profile-1", gardenId: "garden-1"))
        try await store.save(draft(id: "draft-b", profileId: "profile-1", gardenId: "garden-2"))
        try await store.save(draft(id: "draft-c", profileId: "profile-2", gardenId: "garden-1"))

        let allForProfile = try await store.fetchAll(profileId: "profile-1", gardenId: nil)
        #expect(Set(allForProfile.map(\.id)) == ["draft-a", "draft-b"])

        let scopedToGarden = try await store.fetchAll(profileId: "profile-1", gardenId: "garden-1")
        #expect(scopedToGarden.map(\.id) == ["draft-a"])
    }

    @Test("delete removes exactly one draft")
    func deleteRemovesDraft() async throws {
        let store = GRDBLocalDraftStore(dbQueue: try makeDatabase())
        try await store.save(draft(id: "draft-1"))
        try await store.save(draft(id: "draft-2"))

        try await store.delete(id: "draft-1")

        let fetched = try await store.fetch(id: "draft-1")
        #expect(fetched == nil)
        #expect(try await store.fetch(id: "draft-2") != nil)
    }
}
