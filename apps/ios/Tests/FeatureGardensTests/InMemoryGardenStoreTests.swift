import CoreDomain
import Foundation
import Testing

@testable import FeatureGardens

@Suite("In-memory garden store")
struct InMemoryGardenStoreTests {
    private func garden(id: String, name: String, createdAt: Date) -> Garden {
        Garden(
            id: id,
            name: name,
            lifecycleState: .active,
            callerRole: .owner,
            revision: 1,
            createdAt: createdAt,
            updatedAt: createdAt
        )
    }

    @Test("Starts empty")
    func startsEmpty() async throws {
        let store = InMemoryGardenStore()
        #expect(try await store.fetchAll().isEmpty)
    }

    @Test("replaceAll replaces the whole cache, most recently created first")
    func replaceAllOrdersByCreationDescending() async throws {
        let store = InMemoryGardenStore()
        let older = garden(id: "1", name: "Older", createdAt: Date(timeIntervalSince1970: 0))
        let newer = garden(id: "2", name: "Newer", createdAt: Date(timeIntervalSince1970: 100))

        try await store.replaceAll(with: [older, newer])

        let all = try await store.fetchAll()
        #expect(all.map(\.id) == ["2", "1"])
    }

    @Test("save upserts a single garden without disturbing the rest of the cache")
    func saveUpserts() async throws {
        let store = InMemoryGardenStore()
        let original = garden(id: "1", name: "Backyard", createdAt: Date(timeIntervalSince1970: 0))
        try await store.replaceAll(with: [original])

        let renamed = garden(id: "1", name: "Front Yard", createdAt: Date(timeIntervalSince1970: 0))
        try await store.save(renamed)

        let all = try await store.fetchAll()
        #expect(all.count == 1)
        #expect(all.first?.name == "Front Yard")
    }

    private func operation(id: String, gardenId: String) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: "gardens.create",
            commandVersion: 1,
            targetRecordIds: [gardenId],
            expectedRevision: nil,
            payload: #"{"recordType":"garden"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("commitOfflineMutation applies the projection and hands the current record to the command")
    func commitOfflineMutationAppliesProjection() async throws {
        let store = InMemoryGardenStore()
        let created = garden(id: "1", name: "Backyard", createdAt: Date(timeIntervalSince1970: 0))

        let result = try await store.commitOfflineMutation(gardenId: "1") { current in
            #expect(current == nil)
            return (created, operation(id: "op-1", gardenId: "1"))
        }

        #expect(result == created)
        #expect(try await store.fetchAll() == [created])
    }

    @Test("replaceAll preserves a garden with a pending offline mutation")
    func replaceAllPreservesPendingGarden() async throws {
        let store = InMemoryGardenStore()
        let pending = garden(id: "pending", name: "Not synced yet", createdAt: Date(timeIntervalSince1970: 0))
        _ = try await store.commitOfflineMutation(gardenId: "pending") { _ in
            (pending, operation(id: "op-1", gardenId: "pending"))
        }

        let confirmed = garden(id: "confirmed", name: "From server", createdAt: Date(timeIntervalSince1970: 0))
        try await store.replaceAll(with: [confirmed])

        let all = try await store.fetchAll()
        #expect(Set(all.map(\.id)) == ["pending", "confirmed"])
        #expect(all.first(where: { $0.id == "pending" })?.name == "Not synced yet")
    }

    @Test("save skips overwriting a garden with a pending offline mutation")
    func saveSkipsPendingGarden() async throws {
        let store = InMemoryGardenStore()
        let pending = garden(id: "1", name: "Renamed locally", createdAt: Date(timeIntervalSince1970: 0))
        _ = try await store.commitOfflineMutation(gardenId: "1") { _ in
            (pending, operation(id: "op-1", gardenId: "1"))
        }

        try await store.save(garden(id: "1", name: "Stale server name", createdAt: Date(timeIntervalSince1970: 0)))

        #expect(try await store.fetchAll().first?.name == "Renamed locally")
    }
}
