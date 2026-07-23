import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

@Suite("Media transfer store")
struct MediaTransferStoreTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func transfer(
        id: String = "media-1",
        gardenId: String = "garden-1",
        state: MediaTransferState
    ) -> MediaTransfer {
        MediaTransfer(
            id: id,
            gardenId: gardenId,
            localFileUrl: "file:///tmp/\(id).jpg",
            checksum: "abc123",
            byteCount: 4096,
            state: state,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("save then fetch round-trips every field")
    func saveRoundTripsFields() async throws {
        let store = GRDBMediaTransferStore(dbQueue: try makeDatabase())
        let saved = transfer(state: .uploading)

        try await store.save(saved)

        let fetched = try await store.fetch(id: "media-1")
        #expect(fetched == saved)
    }

    @Test("fetchPending excludes terminal states (retained, deleted)")
    func fetchPendingExcludesTerminalStates() async throws {
        let store = GRDBMediaTransferStore(dbQueue: try makeDatabase())
        try await store.save(transfer(id: "queued", state: .queued))
        try await store.save(transfer(id: "uploading", state: .uploading))
        try await store.save(transfer(id: "retained", state: .retained))
        try await store.save(transfer(id: "deleted", state: .deleted))

        let pending = try await store.fetchPending(gardenId: "garden-1")

        #expect(Set(pending.map(\.id)) == ["queued", "uploading"])
    }

    @Test("save upserts by media ID")
    func saveUpsertsByMediaId() async throws {
        let store = GRDBMediaTransferStore(dbQueue: try makeDatabase())
        try await store.save(transfer(state: .captured))
        try await store.save(transfer(state: .verifying))

        let fetched = try await store.fetch(id: "media-1")
        #expect(fetched?.state == .verifying)
    }
}
