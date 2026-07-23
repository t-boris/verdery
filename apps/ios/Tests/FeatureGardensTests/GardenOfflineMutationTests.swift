import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureGardens

/// Real-database (not mocked) coverage of `GRDBGardenStore.commitOfflineMutation`
/// and the pending-aware `replaceAll(with:)`/`save(_:)` behavior it requires
/// — the local half of architecture/offline-synchronization.md, section
/// "6. Local Mutation Transaction". Follows
/// `CorePersistenceTests.MigrationIntegrityTests`'s own approach: a real
/// GRDB database built from `LocalDatabase.migrator`, not a store double, so
/// a passing test proves the actual SQLite transaction behavior, not a
/// mock's approximation of it.
@Suite("Garden offline mutation (GRDB)")
struct GardenOfflineMutationTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func garden(
        id: String,
        name: String = "Backyard",
        lifecycleState: GardenLifecycleState = .active,
        revision: Int = 0
    ) -> Garden {
        Garden(
            id: id,
            name: name,
            lifecycleState: lifecycleState,
            callerRole: .owner,
            revision: revision,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func operation(
        id: String,
        gardenId: String,
        commandType: String = "gardens.create",
        expectedRevision: Int? = nil
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: 1,
            targetRecordIds: [gardenId],
            expectedRevision: expectedRevision,
            payload: #"{"recordType":"garden"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("commitOfflineMutation writes the projection and the outbox operation in the same transaction")
    func commitWritesBothTables() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let projection = garden(id: "garden-1")
        let result = try await store.commitOfflineMutation(gardenId: "garden-1") { current in
            #expect(current == nil)
            return (projection, self.operation(id: "op-1", gardenId: "garden-1"))
        }

        #expect(result == projection)

        let storedGardens = try await store.fetchAll()
        #expect(storedGardens == [projection])

        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["op-1"])
        #expect(storedOperations.first?.localSequence == 1)
        #expect(storedOperations.first?.gardenId == "garden-1")
    }

    @Test("commitOfflineMutation loads the current record from inside the same transaction")
    func commitLoadsCurrentRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { current in
            #expect(current == nil)
            return (self.garden(id: "garden-1", name: "Backyard"), self.operation(id: "op-1", gardenId: "garden-1"))
        }

        let renamed = try await store.commitOfflineMutation(gardenId: "garden-1") { current in
            #expect(current?.name == "Backyard")
            let updated = self.garden(id: "garden-1", name: "Front Yard")
            return (
                updated,
                self.operation(id: "op-2", gardenId: "garden-1", commandType: "gardens.rename", expectedRevision: 1)
            )
        }

        #expect(renamed.name == "Front Yard")
    }

    @Test("A thrown validation error inside the command writes nothing")
    func throwingCommandWritesNothing() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let failure = await #expect(throws: GardenCommandError.self) {
            try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
                throw GardenCommandError.invalidName
            }
        }

        #expect(failure == .invalidName)
        #expect(try await store.fetchAll().isEmpty)
        #expect(try await outbox.fetchAll().isEmpty)
    }

    /// Termination-at-boundary fault test: proves the local read-model write
    /// and the outbox insert commit atomically — one real GRDB transaction,
    /// not two independent writes a process could be killed between.
    ///
    /// Actual process termination is not practically simulable in a unit
    /// test — see `MigrationIntegrityTests`'s own doc comment for the same
    /// reasoning applied to migrations. This instead forces a real
    /// constraint violation on the SECOND write inside the transaction (a
    /// duplicate `sync_outbox.id`, which is a primary key — see
    /// `LocalDatabase+SynchronizationMigrations.swift`) and proves the FIRST
    /// write (the garden projection) rolls back with it. The only way that
    /// can happen is if both writes share one transaction, exactly as
    /// `GRDBGardenStore.commitOfflineMutation`'s single `dbQueue.write`
    /// block requires.
    @Test("A failure enqueuing the outbox operation rolls back the projection write too")
    func outboxFailureRollsBackProjection() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        // A real prior row occupying the operation ID the second commit will
        // try to reuse.
        try await outbox.enqueue(operation(id: "duplicate-op", gardenId: "garden-0"))

        let failure = await #expect(throws: (any Error).self) {
            try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
                (self.garden(id: "garden-1"), self.operation(id: "duplicate-op", gardenId: "garden-1"))
            }
        }
        #expect(failure != nil)

        // The projection write ran first inside the same transaction as the
        // failed outbox insert — if it had survived independently, this
        // would find "garden-1".
        let storedGardens = try await store.fetchAll()
        #expect(storedGardens.isEmpty)

        // The pre-existing row is untouched, and no second row was created
        // under the same id.
        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["duplicate-op"])
        #expect(storedOperations.first?.gardenId == "garden-0")
    }

    /// The positive half of the termination-at-boundary evidence: once
    /// `commitOfflineMutation` returns, both writes are durably present
    /// together — if the process were to terminate at any point afterward,
    /// there is no partially-applied state to recover from.
    @Test("After a successful commit, both the projection and the outbox operation are durably present")
    func successfulCommitLeavesBothWritesDurable() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (self.garden(id: "garden-1"), self.operation(id: "op-1", gardenId: "garden-1"))
        }

        // Independently reopened stores against the same file-backed queue
        // read back what actually committed to disk, not in-process state.
        let rereadStore = GRDBGardenStore(dbQueue: dbQueue)
        let rereadOutbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        #expect(try await rereadStore.fetchAll().map(\.id) == ["garden-1"])
        #expect(try await rereadOutbox.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("replaceAll preserves a garden with a pending outbox operation")
    func replaceAllPreservesPendingGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)

        let pending = garden(id: "garden-pending", name: "Not synced yet")
        _ = try await store.commitOfflineMutation(gardenId: "garden-pending") { _ in
            (pending, self.operation(id: "op-1", gardenId: "garden-pending"))
        }

        // The server's list, as if the pending garden does not exist there
        // yet and one other, already-synced garden does.
        let confirmed = garden(id: "garden-confirmed", name: "From server")
        try await store.replaceAll(with: [confirmed])

        let stored = try await store.fetchAll()
        #expect(Set(stored.map(\.id)) == ["garden-pending", "garden-confirmed"])
        #expect(stored.first(where: { $0.id == "garden-pending" })?.name == "Not synced yet")
    }

    @Test("replaceAll still removes a non-pending garden the server no longer returns")
    func replaceAllRemovesNonPendingGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)

        try await store.replaceAll(with: [garden(id: "garden-old")])
        try await store.replaceAll(with: [])

        #expect(try await store.fetchAll().isEmpty)
    }

    @Test("save skips overwriting a garden with a pending outbox operation")
    func saveSkipsPendingGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)

        let pending = garden(id: "garden-1", name: "Renamed locally")
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (pending, self.operation(id: "op-1", gardenId: "garden-1"))
        }

        try await store.save(garden(id: "garden-1", name: "Stale server name"))

        #expect(try await store.fetchAll().first?.name == "Renamed locally")
    }

    @Test("save writes normally when nothing is pending for that garden")
    func saveWritesWhenNotPending() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)

        try await store.save(garden(id: "garden-1", name: "Confirmed"))

        #expect(try await store.fetchAll().first?.name == "Confirmed")
    }

    @Test("confirmSynced advances only the revision column, leaving every other field untouched")
    func confirmSyncedAdvancesRevisionOnly() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)

        let pending = garden(id: "garden-1", name: "Renamed locally", revision: 0)
        _ = try await store.commitOfflineMutation(gardenId: "garden-1") { _ in
            (pending, self.operation(id: "op-1", gardenId: "garden-1"))
        }
        try await GRDBSyncOutboxStore(dbQueue: dbQueue).remove(operationId: "op-1")

        try await store.confirmSynced(gardenId: "garden-1", revision: 4)

        let confirmed = try #require(await store.fetchAll().first)
        #expect(confirmed.name == "Renamed locally")
        #expect(confirmed.revision == 4)
    }

    @Test("confirmSynced is a silent no-op for a garden this device has no local row for")
    func confirmSyncedNoOpForUnknownGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBGardenStore(dbQueue: dbQueue)

        try await store.confirmSynced(gardenId: "unknown", revision: 4)

        #expect(try await store.fetchAll().isEmpty)
    }
}
