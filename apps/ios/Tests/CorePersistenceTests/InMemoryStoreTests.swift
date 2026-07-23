import CoreDomain
import Foundation
import Testing

@testable import CorePersistence

/// The in-memory doubles behave the same way their GRDB-backed counterparts
/// do for the contract that matters most to a caller: local processing order
/// for the outbox, and per-garden cursor independence — the two stores this
/// work package's brief explicitly asks for a double of. `GRDBSyncOutboxStore
/// Tests` and `SyncCursorStoreTests` cover the GRDB-backed implementations'
/// full behavior; this suite only proves the doubles agree on the same
/// contract, the same way `InMemoryGardenStoreTests` does for
/// `FeatureGardens`.
@Suite("In-memory synchronization store doubles")
struct InMemoryStoreTests {
    @Test("InMemorySyncOutboxStore assigns increasing local sequence and filters by garden")
    func inMemoryOutboxAssignsSequenceAndFilters() async throws {
        let store = InMemorySyncOutboxStore()

        func operation(id: String, gardenId: String) -> OutboxOperation {
            OutboxOperation(
                id: id, profileId: "profile-1", gardenId: gardenId, commandType: "createObject",
                commandVersion: 1, targetRecordIds: [], expectedRevision: nil, payload: "{}",
                createdAt: Date(timeIntervalSince1970: 0)
            )
        }

        let first = try await store.enqueue(operation(id: "op-1", gardenId: "garden-a"))
        try await store.enqueue(operation(id: "op-2", gardenId: "garden-b"))
        let third = try await store.enqueue(operation(id: "op-3", gardenId: "garden-a"))

        #expect(first.localSequence == 1)
        #expect(third.localSequence == 3)

        let pending = try await store.fetchPending(gardenId: "garden-a")
        #expect(pending.map(\.id) == ["op-1", "op-3"])
    }

    @Test("InMemorySyncOutboxStore recordAttempt and remove")
    func inMemoryOutboxAttemptAndRemove() async throws {
        let store = InMemorySyncOutboxStore()
        let operation = OutboxOperation(
            id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "createObject",
            commandVersion: 1, targetRecordIds: [], expectedRevision: nil, payload: "{}",
            createdAt: Date()
        )
        try await store.enqueue(operation)

        try await store.recordAttempt(operationId: "op-1", errorCategory: .server, at: Date(timeIntervalSince1970: 5))
        let attempted = try await store.fetchAll().first
        #expect(attempted?.retryState.attemptCount == 1)
        #expect(attempted?.retryState.lastErrorCategory == .server)

        try await store.remove(operationId: "op-1")
        #expect(try await store.fetchAll().isEmpty)
    }

    @Test("InMemorySyncCursorStore keeps cursors independent per garden")
    func inMemoryCursorKeepsGardensIndependent() async throws {
        let store = InMemorySyncCursorStore()

        try await store.advance(gardenId: "garden-a", cursor: "cursor-a", at: Date(timeIntervalSince1970: 0))
        try await store.advance(gardenId: "garden-b", cursor: "cursor-b", at: Date(timeIntervalSince1970: 0))

        #expect(try await store.cursor(forGarden: "garden-a")?.cursor == "cursor-a")
        #expect(try await store.cursor(forGarden: "garden-b")?.cursor == "cursor-b")

        try await store.reset(gardenId: "garden-a")
        #expect(try await store.cursor(forGarden: "garden-a") == nil)
        #expect(try await store.cursor(forGarden: "garden-b")?.cursor == "cursor-b")
    }
}
