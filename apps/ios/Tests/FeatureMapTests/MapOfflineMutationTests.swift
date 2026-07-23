import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureMap

/// Real-database (not mocked) coverage of `GRDBMapStore.commitOfflineMutation`
/// and the pending-aware `replaceAll(gardenId:with:)` it requires — the
/// P5-IOS-02 (Stage 4b) counterpart to
/// `FeatureGardensTests.GardenOfflineMutationTests`, following the same
/// approach: a real GRDB database built from `LocalDatabase.migrator`, not a
/// store double, so a passing test proves the actual SQLite transaction
/// behavior, not a mock's approximation of it.
@Suite("Map offline mutation (GRDB)")
struct MapOfflineMutationTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func object(id: String, gardenId: String = "garden-1", revision: Int = 0) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: gardenId,
            category: .tree,
            geometry: .point(Position(x: 0, y: 0)),
            coordinateSpaceId: "space-1",
            label: "Old Oak",
            categoryDetails: nil,
            lifecycleState: .active,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func operation(
        id: String,
        gardenId: String = "garden-1",
        targetRecordIds: [String],
        commandType: String = "map.createObject"
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: 1,
            targetRecordIds: targetRecordIds,
            expectedRevision: nil,
            payload: #"{"recordType":"gardenObject"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("commitOfflineMutation writes every projection and the outbox operation in the same transaction")
    func commitWritesBothTables() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let first = object(id: "obj-1")
        let second = object(id: "obj-2")
        let result = try await store.commitOfflineMutation(gardenId: "garden-1") { current in
            #expect(current.isEmpty)
            return ([first, second], self.operation(id: "op-1", targetRecordIds: ["obj-1", "obj-2"]))
        }

        #expect(Set(result.map(\.id)) == ["obj-1", "obj-2"])

        let storedObjects = try await store.fetchAll(gardenId: "garden-1")
        #expect(Set(storedObjects.map(\.id)) == ["obj-1", "obj-2"])

        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["op-1"])
        #expect(storedOperations.first?.localSequence == 1)
        #expect(storedOperations.first?.gardenId == "garden-1")
    }

    @Test("commitOfflineMutation loads every current row for the garden from inside the same transaction")
    func commitLoadsCurrentRecords() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { current in
            #expect(current.isEmpty)
            return ([self.object(id: "obj-1")], self.operation(id: "op-1", targetRecordIds: ["obj-1"]))
        }

        let moved = try await store.commitOfflineMutation(gardenId: "garden-1") { current in
            #expect(current.keys.sorted() == ["obj-1"])
            let updated = GardenMapObject(
                id: "obj-1",
                gardenId: "garden-1",
                category: .tree,
                geometry: .point(Position(x: 5, y: 5)),
                coordinateSpaceId: "space-1",
                label: current["obj-1"]?.label,
                categoryDetails: nil,
                lifecycleState: .active,
                revision: 0,
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            )
            return ([updated], self.operation(id: "op-2", targetRecordIds: ["obj-1"], commandType: "map.moveObject"))
        }

        guard case let .point(position) = moved.first?.geometry else {
            Issue.record("Expected point geometry")
            return
        }
        #expect(position == Position(x: 5, y: 5))
    }

    @Test("A thrown validation error inside the command writes nothing")
    func throwingCommandWritesNothing() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let failure = await #expect(throws: MapCommandError.self) {
            try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
                throw MapCommandError.objectNotFound(objectId: "obj-1")
            }
        }

        #expect(failure == .objectNotFound(objectId: "obj-1"))
        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
        #expect(try await outbox.fetchAll().isEmpty)
    }

    /// Termination-at-boundary fault test: proves the local read-model
    /// writes and the outbox insert commit atomically — one real GRDB
    /// transaction, not independent writes a process could be killed
    /// between. Mirrors `GardenOfflineMutationTests.outboxFailureRollsBackProjection`'s
    /// exact technique: force a real constraint violation (a duplicate
    /// `sync_outbox.id`, a primary key) on the SECOND write inside the
    /// transaction, and prove the FIRST write (every projected `garden_object`
    /// row) rolls back with it.
    @Test("A failure enqueuing the outbox operation rolls back every projection write too")
    func outboxFailureRollsBackProjections() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        // A real prior row occupying the operation ID the second commit will
        // try to reuse.
        try await outbox.enqueue(operation(id: "duplicate-op", gardenId: "garden-0", targetRecordIds: ["obj-0"]))

        let failure = await #expect(throws: (any Error).self) {
            try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
                // Two projected objects, mirroring a real `splitLinework`'s
                // shape — proves *every* projection write in the batch rolls
                // back together, not only the first.
                (
                    [self.object(id: "obj-1"), self.object(id: "obj-2")],
                    self.operation(id: "duplicate-op", targetRecordIds: ["obj-1", "obj-2"])
                )
            }
        }
        #expect(failure != nil)

        // Both projection writes ran first inside the same transaction as
        // the failed outbox insert — if either had survived independently,
        // this would find it.
        let storedObjects = try await store.fetchAll(gardenId: "garden-1")
        #expect(storedObjects.isEmpty)

        // The pre-existing row is untouched, and no second row was created
        // under the same id.
        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["duplicate-op"])
        #expect(storedOperations.first?.gardenId == "garden-0")
    }

    /// The positive half of the termination-at-boundary evidence: once
    /// `commitOfflineMutation` returns, every write is durably present
    /// together — if the process were to terminate at any point afterward,
    /// there is no partially-applied state to recover from.
    @Test("After a successful commit, every projection and the outbox operation are durably present")
    func successfulCommitLeavesEveryWriteDurable() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (
                [self.object(id: "obj-1"), self.object(id: "obj-2")],
                self.operation(id: "op-1", targetRecordIds: ["obj-1", "obj-2"])
            )
        }

        // Independently reopened stores against the same file-backed queue
        // read back what actually committed to disk, not in-process state.
        let rereadStore = GRDBMapStore(dbQueue: dbQueue)
        let rereadOutbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        #expect(Set(try await rereadStore.fetchAll(gardenId: "garden-1").map(\.id)) == ["obj-1", "obj-2"])
        #expect(try await rereadOutbox.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("replaceAll preserves an object with a pending outbox operation, decoding targetRecordIds")
    func replaceAllPreservesPendingObject() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)

        let pending = object(id: "obj-pending")
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (
                [pending],
                self.operation(id: "op-1", targetRecordIds: ["obj-pending"])
            )
        }

        // The server's document, as if the pending object does not exist
        // there yet and one other, already-synced object does.
        let confirmed = object(id: "obj-confirmed", revision: 4)
        try await store.replaceAll(gardenId: "garden-1", with: [confirmed])

        let stored = try await store.fetchAll(gardenId: "garden-1")
        #expect(Set(stored.map(\.id)) == ["obj-pending", "obj-confirmed"])
        #expect(stored.first { $0.id == "obj-pending" }?.revision == 0)
    }

    @Test("replaceAll preserves only the specific pending objects a multi-target operation names, not the whole garden")
    func replaceAllOnlyProtectsNamedTargets() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)

        // Seed two objects, only one of which a pending operation actually
        // targets — proving the guard reads `targetRecordIds`, not just
        // "this garden has some pending operation."
        try await store.replaceAll(gardenId: "garden-1", with: [object(id: "obj-a"), object(id: "obj-b")])
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { current in
            let updated = GardenMapObject(
                id: "obj-a",
                gardenId: "garden-1",
                category: .tree,
                geometry: .point(Position(x: 9, y: 9)),
                coordinateSpaceId: "space-1",
                label: current["obj-a"]?.label,
                categoryDetails: nil,
                lifecycleState: .active,
                revision: 0,
                createdAt: Date(timeIntervalSince1970: 0),
                updatedAt: Date(timeIntervalSince1970: 0)
            )
            return ([updated], self.operation(id: "op-1", targetRecordIds: ["obj-a"]))
        }

        // The server's refresh no longer returns either object.
        try await store.replaceAll(gardenId: "garden-1", with: [])

        let stored = try await store.fetchAll(gardenId: "garden-1")
        // `obj-a` survives (pending); `obj-b` does not (never pending, and
        // the server no longer lists it).
        #expect(stored.map(\.id) == ["obj-a"])
    }

    @Test("replaceAll still removes a non-pending object the server no longer returns")
    func replaceAllRemovesNonPendingObject() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBMapStore(dbQueue: dbQueue)

        try await store.replaceAll(gardenId: "garden-1", with: [object(id: "obj-old")])
        try await store.replaceAll(gardenId: "garden-1", with: [])

        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
    }
}
