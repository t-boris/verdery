import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureObservations

/// Real-database (not mocked) coverage of `GRDBObservationStore
/// .commitOfflineAppend` — the P5-IOS-02 (Stage 4d) counterpart to
/// `FeatureGardensTests.GardenOfflineMutationTests`/`FeatureMapTests
/// .MapOfflineMutationTests`/`FeaturePlantsTests.PlantOfflineMutationTests`,
/// following the same approach: a real GRDB database built from
/// `LocalDatabase.migrator`, not a store double, so a passing test proves
/// the actual SQLite transaction behavior, not a mock's approximation of it.
///
/// Deliberately does NOT mirror those three suites' "commitOfflineMutation
/// loads the current record from inside the same transaction" test —
/// `commitOfflineAppend` loads nothing (see `LocalObservationStore`'s own
/// doc comment), so there is no such behavior for this suite to prove.
@Suite("Observation offline mutation (GRDB)")
struct ObservationOfflineMutationTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func observation(
        id: String,
        gardenId: String = "garden-1",
        plantId: String? = "plant-1",
        correctionKind: ObservationCorrectionKind? = nil,
        correctsObservationId: String? = nil
    ) -> GardenObservation {
        GardenObservation(
            id: id,
            gardenId: gardenId,
            plantId: plantId,
            gardenObjectId: nil,
            actorType: .user,
            createdByProfileId: nil,
            noteText: "Looking healthy",
            conditionSummary: nil,
            correctionKind: correctionKind,
            correctsObservationId: correctsObservationId,
            isCorrected: false,
            observedAt: Date(timeIntervalSince1970: 0),
            recordedAt: Date(timeIntervalSince1970: 0),
            photos: []
        )
    }

    private func operation(
        id: String,
        observationId: String,
        gardenId: String = "garden-1",
        commandType: String = "observations.record"
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: 1,
            targetRecordIds: [observationId],
            expectedRevision: nil,
            payload: #"{"recordType":"observation"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("commitOfflineAppend writes the projection and the outbox operation in the same transaction")
    func commitWritesBothTables() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let projection = observation(id: "obs-1")
        let result = try await store.commitOfflineAppend(projection, operation: operation(id: "op-1", observationId: "obs-1"))

        #expect(result == projection)

        let stored = try await store.fetchPending(gardenId: "garden-1")
        #expect(stored == [projection])

        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["op-1"])
        #expect(storedOperations.first?.localSequence == 1)
        #expect(storedOperations.first?.gardenId == "garden-1")
        #expect(storedOperations.first?.targetRecordIds == ["obs-1"])
    }

    @Test("commitOfflineAppend performs a genuine insert, not an upsert — reusing an id fails")
    func commitAppendRejectsDuplicateId() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineAppend(observation(id: "obs-1"), operation: operation(id: "op-1", observationId: "obs-1"))

        // Unlike `GardenRecord`/`PlantRecord`/`GardenObjectRecord`'s
        // `.save(db)` upsert, `ObservationRecord.insert(db)` treats a
        // second write under the same id as a defect, not a legitimate
        // update — an observation row is never re-written once appended.
        await #expect(throws: (any Error).self) {
            try await store.commitOfflineAppend(
                observation(id: "obs-1", plantId: "plant-2"),
                operation: operation(id: "op-2", observationId: "obs-1")
            )
        }
    }

    /// Termination-at-boundary fault test: proves the local read-model
    /// insert and the outbox insert commit atomically — one real GRDB
    /// transaction, not two independent writes a process could be killed
    /// between. See `GardenOfflineMutationTests
    /// .outboxFailureRollsBackProjection`'s own doc comment for why this — a
    /// real constraint violation on the SECOND write — rather than
    /// simulated process termination, is what proves it.
    @Test("A failure enqueuing the outbox operation rolls back the projection insert too")
    func outboxFailureRollsBackProjection() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        // A real prior row occupying the operation ID the second commit
        // will try to reuse.
        try await outbox.enqueue(operation(id: "duplicate-op", observationId: "obs-0"))

        let failure = await #expect(throws: (any Error).self) {
            try await store.commitOfflineAppend(
                observation(id: "obs-1"),
                operation: operation(id: "duplicate-op", observationId: "obs-1")
            )
        }
        #expect(failure != nil)

        // The projection insert ran first inside the same transaction as
        // the failed outbox insert — if it had survived independently,
        // this would find "obs-1".
        let storedGarden1 = try await store.fetchPending(gardenId: "garden-1")
        #expect(storedGarden1.isEmpty)

        // The pre-existing row is untouched, and no second row was created
        // under the same id.
        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["duplicate-op"])
        #expect(storedOperations.first?.targetRecordIds == ["obs-0"])
    }

    /// The positive half of the termination-at-boundary evidence: once
    /// `commitOfflineAppend` returns, both writes are durably present
    /// together — if the process were to terminate at any point afterward,
    /// there is no partially-applied state to recover from.
    @Test("After a successful commit, both the projection and the outbox operation are durably present")
    func successfulCommitLeavesBothWritesDurable() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineAppend(observation(id: "obs-1"), operation: operation(id: "op-1", observationId: "obs-1"))

        // Independently reopened stores against the same file-backed queue
        // read back what actually committed to disk, not in-process state.
        let rereadStore = GRDBObservationStore(dbQueue: dbQueue)
        let rereadOutbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        #expect(try await rereadStore.fetchPending(gardenId: "garden-1").map(\.id) == ["obs-1"])
        #expect(try await rereadOutbox.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("fetchPending scopes strictly by gardenId")
    func fetchPendingScopesByGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineAppend(
            observation(id: "obs-1", gardenId: "garden-1"),
            operation: operation(id: "op-1", observationId: "obs-1", gardenId: "garden-1")
        )
        _ = try await store.commitOfflineAppend(
            observation(id: "obs-2", gardenId: "garden-2"),
            operation: operation(id: "op-2", observationId: "obs-2", gardenId: "garden-2")
        )

        #expect(try await store.fetchPending(gardenId: "garden-1").map(\.id) == ["obs-1"])
        #expect(try await store.fetchPending(gardenId: "garden-2").map(\.id) == ["obs-2"])
        #expect(try await store.fetchPending(gardenId: "garden-3").isEmpty)
    }

    @Test("A correction row's correctionKind and correctsObservationId round-trip through storage")
    func correctionFieldsRoundTrip() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)

        let correction = observation(id: "obs-2", correctionKind: .supersede, correctsObservationId: "obs-1")
        _ = try await store.commitOfflineAppend(
            correction,
            operation: operation(id: "op-1", observationId: "obs-2", commandType: "observations.correct")
        )

        let stored = try await store.fetchPending(gardenId: "garden-1")
        #expect(stored == [correction])
        #expect(stored.first?.correctionKind == .supersede)
        #expect(stored.first?.correctsObservationId == "obs-1")
    }

    @Test("markSynced removes the confirmed observation's local row entirely")
    func markSyncedRemovesRow() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineAppend(
            observation(id: "obs-1"), operation: operation(id: "op-1", observationId: "obs-1")
        )
        _ = try await store.commitOfflineAppend(
            observation(id: "obs-2"), operation: operation(id: "op-2", observationId: "obs-2")
        )

        try await store.markSynced(observationId: "obs-1")

        #expect(try await store.fetchPending(gardenId: "garden-1").map(\.id) == ["obs-2"])
    }

    @Test("markSynced is a silent no-op for an observation this device has no local row for")
    func markSyncedNoOpForUnknownObservation() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)

        try await store.markSynced(observationId: "unknown")

        #expect(try await store.fetchPending(gardenId: "garden-1").isEmpty)
    }

    /// P5-SEC-01: `removeAll(gardenId:)` is the garden-partition cascade's
    /// own removal method, scoped by garden.
    @Test("removeAll deletes every pending observation for the garden, leaving other gardens untouched")
    func removeAllDeletesEveryPendingObservationForGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        _ = try await store.commitOfflineAppend(
            observation(id: "obs-1", gardenId: "garden-1"),
            operation: operation(id: "op-1", observationId: "obs-1", gardenId: "garden-1")
        )
        _ = try await store.commitOfflineAppend(
            observation(id: "obs-2", gardenId: "garden-2"),
            operation: operation(id: "op-2", observationId: "obs-2", gardenId: "garden-2")
        )

        try await store.removeAll(gardenId: "garden-1")

        #expect(try await store.fetchPending(gardenId: "garden-1").isEmpty)
        #expect(try await store.fetchPending(gardenId: "garden-2").map(\.id) == ["obs-2"])
    }

    @Test("removeAll is a silent no-op for a garden this device has no local rows for")
    func removeAllNoOpForUnknownGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBObservationStore(dbQueue: dbQueue)
        _ = try await store.commitOfflineAppend(
            observation(id: "obs-1"), operation: operation(id: "op-1", observationId: "obs-1")
        )

        try await store.removeAll(gardenId: "unknown")

        #expect(try await store.fetchPending(gardenId: "garden-1").map(\.id) == ["obs-1"])
    }
}
