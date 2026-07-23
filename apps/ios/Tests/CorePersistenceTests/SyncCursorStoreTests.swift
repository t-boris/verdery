import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

@Suite("Sync cursor store")
struct SyncCursorStoreTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    @Test("A garden with no recorded cursor returns nil")
    func unknownGardenReturnsNil() async throws {
        let store = GRDBSyncCursorStore(dbQueue: try makeDatabase())
        #expect(try await store.cursor(forGarden: "garden-1") == nil)
    }

    @Test("advance creates then updates the durable cursor for one garden")
    func advanceCreatesThenUpdates() async throws {
        let store = GRDBSyncCursorStore(dbQueue: try makeDatabase())

        try await store.advance(gardenId: "garden-1", cursor: "cursor-a", at: Date(timeIntervalSince1970: 0))
        let first = try await store.cursor(forGarden: "garden-1")
        #expect(first?.cursor == "cursor-a")

        try await store.advance(gardenId: "garden-1", cursor: "cursor-b", at: Date(timeIntervalSince1970: 10))
        let second = try await store.cursor(forGarden: "garden-1")
        #expect(second?.cursor == "cursor-b")
        #expect(second?.updatedAt == Date(timeIntervalSince1970: 10))
    }

    @Test("Cursors are independent per garden partition")
    func cursorsAreIndependentPerGarden() async throws {
        let store = GRDBSyncCursorStore(dbQueue: try makeDatabase())

        try await store.advance(gardenId: "garden-a", cursor: "cursor-a", at: Date())
        try await store.advance(gardenId: "garden-b", cursor: "cursor-b", at: Date())

        #expect(try await store.cursor(forGarden: "garden-a")?.cursor == "cursor-a")
        #expect(try await store.cursor(forGarden: "garden-b")?.cursor == "cursor-b")
    }

    @Test("reset clears the durable cursor for a full resynchronization")
    func resetClearsCursor() async throws {
        let store = GRDBSyncCursorStore(dbQueue: try makeDatabase())
        try await store.advance(gardenId: "garden-1", cursor: "cursor-a", at: Date())

        try await store.reset(gardenId: "garden-1")

        #expect(try await store.cursor(forGarden: "garden-1") == nil)
    }
}
