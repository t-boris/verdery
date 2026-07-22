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
}
