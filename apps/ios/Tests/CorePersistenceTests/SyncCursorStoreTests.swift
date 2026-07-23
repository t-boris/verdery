import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

/// Covers the profile-scoped singleton shape `SyncCursorStore` was corrected
/// to in P5-IOS-03, Stage 5b — see `CoreDomain.SyncCursor`'s own doc comment
/// for why a per-garden cursor was wrong: `GET /sync/changes` takes no
/// `gardenId` at all, so one row per profile-scoped database file, not one
/// row per garden, is what the shipped contract actually needs.
@Suite("Sync cursor store")
struct SyncCursorStoreTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    @Test("A fresh database has no recorded cursor")
    func freshDatabaseReturnsNil() async throws {
        let store = GRDBSyncCursorStore(dbQueue: try makeDatabase())
        #expect(try await store.current() == nil)
    }

    @Test("advance creates then updates the one durable cursor")
    func advanceCreatesThenUpdates() async throws {
        let store = GRDBSyncCursorStore(dbQueue: try makeDatabase())

        try await store.advance(cursor: "cursor-a", at: Date(timeIntervalSince1970: 0))
        let first = try await store.current()
        #expect(first?.cursor == "cursor-a")

        try await store.advance(cursor: "cursor-b", at: Date(timeIntervalSince1970: 10))
        let second = try await store.current()
        #expect(second?.cursor == "cursor-b")
        #expect(second?.updatedAt == Date(timeIntervalSince1970: 10))
    }

    @Test("reset clears the durable cursor for a full resynchronization")
    func resetClearsCursor() async throws {
        let store = GRDBSyncCursorStore(dbQueue: try makeDatabase())
        try await store.advance(cursor: "cursor-a", at: Date())

        try await store.reset()

        #expect(try await store.current() == nil)
    }
}
