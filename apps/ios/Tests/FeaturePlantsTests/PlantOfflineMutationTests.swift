import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeaturePlants

/// Real-database (not mocked) coverage of `GRDBPlantStore.commitOfflineMutation`
/// and the pending-aware `save(_:)` it requires — the P5-IOS-02 (Stage 4c)
/// counterpart to `FeatureGardensTests.GardenOfflineMutationTests` and
/// `FeatureMapTests.MapOfflineMutationTests`, following the same approach: a
/// real GRDB database built from `LocalDatabase.migrator`, not a store
/// double, so a passing test proves the actual SQLite transaction behavior,
/// not a mock's approximation of it.
@Suite("Plant offline mutation (GRDB)")
struct PlantOfflineMutationTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func plant(
        id: String,
        gardenId: String = "garden-1",
        displayName: String = "Tomato",
        revision: Int = 0
    ) -> Plant {
        Plant(
            id: id,
            gardenId: gardenId,
            gardenAreaMapObjectId: nil,
            placementMapObjectId: nil,
            displayName: displayName,
            taxonomyReferenceId: nil,
            varietyLabel: nil,
            acceptedIdentificationId: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: .individual,
            quantity: nil,
            lifecycleStage: .planned,
            status: .active,
            conditionNote: nil,
            careGuidanceNote: nil,
            revision: revision,
            createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// `targetRecordIds` names the plant itself, per `plantId`'s own default
    /// — a plant's own id, not `gardenId` (the *owning* garden, shared by
    /// every plant in it), is what `GRDBPlantStore`'s pending check decodes,
    /// the same distinction `MapOfflineMutationTests`'s own operation helper
    /// draws for `garden_object`.
    private func operation(
        id: String,
        plantId: String,
        gardenId: String = "garden-1",
        commandType: String = "plants.addPlant",
        expectedRevision: Int? = nil
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: 1,
            targetRecordIds: [plantId],
            expectedRevision: expectedRevision,
            payload: #"{"recordType":"plant"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("commitOfflineMutation writes the projection and the outbox operation in the same transaction")
    func commitWritesBothTables() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let projection = plant(id: "plant-1")
        let result = try await store.commitOfflineMutation(plantId: "plant-1") { current in
            #expect(current == nil)
            return (projection, self.operation(id: "op-1", plantId: "plant-1"))
        }

        #expect(result == projection)

        let stored = try await store.fetch(plantId: "plant-1")
        #expect(stored == projection)

        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["op-1"])
        #expect(storedOperations.first?.localSequence == 1)
        #expect(storedOperations.first?.gardenId == "garden-1")
        #expect(storedOperations.first?.targetRecordIds == ["plant-1"])
    }

    @Test("commitOfflineMutation loads the current record from inside the same transaction")
    func commitLoadsCurrentRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(plantId: "plant-1") { current in
            #expect(current == nil)
            return (
                self.plant(id: "plant-1", displayName: "Tomato"),
                self.operation(id: "op-1", plantId: "plant-1")
            )
        }

        let renamed = try await store.commitOfflineMutation(plantId: "plant-1") { current in
            #expect(current?.displayName == "Tomato")
            let updated = self.plant(id: "plant-1", displayName: "Cherry Tomato")
            return (
                updated,
                self.operation(id: "op-2", plantId: "plant-1", commandType: "plants.updateDetails", expectedRevision: 1)
            )
        }

        #expect(renamed.displayName == "Cherry Tomato")
    }

    @Test("A thrown validation error inside the command writes nothing")
    func throwingCommandWritesNothing() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let failure = await #expect(throws: PlantCommandError.self) {
            try await store.commitOfflineMutation(plantId: "plant-1") { _ in
                throw PlantCommandError.invalidDisplayName
            }
        }

        #expect(failure == .invalidDisplayName)
        #expect(try await store.fetch(plantId: "plant-1") == nil)
        #expect(try await outbox.fetchAll().isEmpty)
    }

    /// Termination-at-boundary fault test: proves the local read-model write
    /// and the outbox insert commit atomically — one real GRDB transaction,
    /// not two independent writes a process could be killed between. See
    /// `GardenOfflineMutationTests.outboxFailureRollsBackProjection`'s own
    /// doc comment for why this — a real constraint violation on the SECOND
    /// write — rather than simulated process termination, is what proves it.
    @Test("A failure enqueuing the outbox operation rolls back the projection write too")
    func outboxFailureRollsBackProjection() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        // A real prior row occupying the operation ID the second commit will
        // try to reuse.
        try await outbox.enqueue(operation(id: "duplicate-op", plantId: "plant-0"))

        let failure = await #expect(throws: (any Error).self) {
            try await store.commitOfflineMutation(plantId: "plant-1") { _ in
                (self.plant(id: "plant-1"), self.operation(id: "duplicate-op", plantId: "plant-1"))
            }
        }
        #expect(failure != nil)

        // The projection write ran first inside the same transaction as the
        // failed outbox insert — if it had survived independently, this
        // would find "plant-1".
        #expect(try await store.fetch(plantId: "plant-1") == nil)

        // The pre-existing row is untouched, and no second row was created
        // under the same id.
        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["duplicate-op"])
        #expect(storedOperations.first?.targetRecordIds == ["plant-0"])
    }

    /// The positive half of the termination-at-boundary evidence: once
    /// `commitOfflineMutation` returns, both writes are durably present
    /// together — if the process were to terminate at any point afterward,
    /// there is no partially-applied state to recover from.
    @Test("After a successful commit, both the projection and the outbox operation are durably present")
    func successfulCommitLeavesBothWritesDurable() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(plantId: "plant-1") { _ in
            (self.plant(id: "plant-1"), self.operation(id: "op-1", plantId: "plant-1"))
        }

        // Independently reopened stores against the same file-backed queue
        // read back what actually committed to disk, not in-process state.
        let rereadStore = GRDBPlantStore(dbQueue: dbQueue)
        let rereadOutbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        #expect(try await rereadStore.fetch(plantId: "plant-1")?.id == "plant-1")
        #expect(try await rereadOutbox.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("save preserves a plant with a pending outbox operation")
    func savePreservesPendingPlant() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)

        let pending = plant(id: "plant-1", displayName: "Not synced yet")
        _ = try await store.commitOfflineMutation(plantId: "plant-1") { _ in
            (pending, self.operation(id: "op-1", plantId: "plant-1"))
        }

        // The server's (necessarily stale) view of the same plant.
        try await store.save(plant(id: "plant-1", displayName: "Stale server name"))

        #expect(try await store.fetch(plantId: "plant-1")?.displayName == "Not synced yet")
    }

    @Test("save writes normally when nothing is pending for that plant")
    func saveWritesWhenNotPending() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)

        try await store.save(plant(id: "plant-1", displayName: "Confirmed"))

        #expect(try await store.fetch(plantId: "plant-1")?.displayName == "Confirmed")
    }

    @Test("save only protects the plant named by a pending operation's targetRecordIds, not the whole garden")
    func savePendingIsScopedPerPlant() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)

        let pending = plant(id: "plant-1", gardenId: "garden-1", displayName: "Not synced yet")
        _ = try await store.commitOfflineMutation(plantId: "plant-1") { _ in
            (pending, self.operation(id: "op-1", plantId: "plant-1", gardenId: "garden-1"))
        }

        // A second, unrelated plant in the SAME garden has no pending
        // operation of its own — a server response for it must still land.
        try await store.save(plant(id: "plant-2", gardenId: "garden-1", displayName: "From server"))

        #expect(try await store.fetch(plantId: "plant-1")?.displayName == "Not synced yet")
        #expect(try await store.fetch(plantId: "plant-2")?.displayName == "From server")
    }

    @Test("confirmSynced advances only the revision column, leaving every other field untouched")
    func confirmSyncedAdvancesRevisionOnly() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)

        let pending = plant(id: "plant-1", displayName: "Renamed locally", revision: 0)
        _ = try await store.commitOfflineMutation(plantId: "plant-1") { _ in
            (pending, self.operation(id: "op-1", plantId: "plant-1", gardenId: "garden-1"))
        }
        try await GRDBSyncOutboxStore(dbQueue: dbQueue).remove(operationId: "op-1")

        try await store.confirmSynced(plantId: "plant-1", revision: 6)

        let confirmed = try #require(await store.fetch(plantId: "plant-1"))
        #expect(confirmed.displayName == "Renamed locally")
        #expect(confirmed.revision == 6)
    }

    @Test("confirmSynced is a silent no-op for a plant this device has no local row for")
    func confirmSyncedNoOpForUnknownPlant() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBPlantStore(dbQueue: dbQueue)

        try await store.confirmSynced(plantId: "unknown", revision: 6)

        #expect(try await store.fetch(plantId: "unknown") == nil)
    }
}
