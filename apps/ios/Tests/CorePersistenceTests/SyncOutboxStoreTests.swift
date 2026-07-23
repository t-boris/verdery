import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence

@Suite("Sync outbox store")
struct SyncOutboxStoreTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func operation(
        id: String = UUIDv7.generate(),
        gardenId: String = "garden-1",
        createdAt: Date = Date(timeIntervalSince1970: 0)
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: "createObject",
            commandVersion: 1,
            targetRecordIds: ["object-1"],
            expectedRevision: 4,
            payload: #"{"kind":"createObject"}"#,
            dependencyOperationIds: ["dependency-1"],
            mediaPrerequisiteIds: ["media-1"],
            createdAt: createdAt
        )
    }

    @Test("enqueue assigns an increasing local sequence in insertion order")
    func enqueueAssignsIncreasingSequence() async throws {
        let store = GRDBSyncOutboxStore(dbQueue: try makeDatabase())

        let first = try await store.enqueue(operation(id: "op-1"))
        let second = try await store.enqueue(operation(id: "op-2"))

        #expect(first.localSequence == 1)
        #expect(second.localSequence == 2)
    }

    @Test("enqueue round-trips every field, including JSON-encoded arrays")
    func enqueueRoundTripsFields() async throws {
        let store = GRDBSyncOutboxStore(dbQueue: try makeDatabase())
        let inserted = try await store.enqueue(operation())

        let fetched = try await store.fetchAll()

        #expect(fetched == [inserted])
        #expect(fetched.first?.targetRecordIds == ["object-1"])
        #expect(fetched.first?.dependencyOperationIds == ["dependency-1"])
        #expect(fetched.first?.mediaPrerequisiteIds == ["media-1"])
        #expect(fetched.first?.expectedRevision == 4)
    }

    @Test("fetchPending filters by garden and preserves local processing order")
    func fetchPendingFiltersByGarden() async throws {
        let store = GRDBSyncOutboxStore(dbQueue: try makeDatabase())
        try await store.enqueue(operation(id: "op-a", gardenId: "garden-a"))
        try await store.enqueue(operation(id: "op-b", gardenId: "garden-b"))
        try await store.enqueue(operation(id: "op-c", gardenId: "garden-a"))

        let pending = try await store.fetchPending(gardenId: "garden-a")

        #expect(pending.map(\.id) == ["op-a", "op-c"])
    }

    @Test("recordAttempt records the retry state without disturbing other fields")
    func recordAttemptUpdatesRetryState() async throws {
        let store = GRDBSyncOutboxStore(dbQueue: try makeDatabase())
        let inserted = try await store.enqueue(operation(id: "op-1"))

        try await store.recordAttempt(
            operationId: "op-1",
            errorCategory: .connectivity,
            at: Date(timeIntervalSince1970: 500)
        )

        let updated = try await store.fetchAll().first
        #expect(updated?.retryState.attemptCount == 1)
        #expect(updated?.retryState.lastErrorCategory == .connectivity)
        #expect(updated?.retryState.lastAttemptedAt == Date(timeIntervalSince1970: 500))
        #expect(updated?.localSequence == inserted.localSequence)
        #expect(updated?.payload == inserted.payload)
    }

    @Test("remove deletes exactly one operation")
    func removeDeletesOperation() async throws {
        let store = GRDBSyncOutboxStore(dbQueue: try makeDatabase())
        try await store.enqueue(operation(id: "op-1"))
        try await store.enqueue(operation(id: "op-2"))

        try await store.remove(operationId: "op-1")

        let remaining = try await store.fetchAll()
        #expect(remaining.map(\.id) == ["op-2"])
    }
}
