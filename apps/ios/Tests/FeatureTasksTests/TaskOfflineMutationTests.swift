import CoreDomain
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureTasks

/// Real-database (not mocked) coverage of `GRDBTaskStore.commitOfflineMutation`
/// and the pending-aware `replaceAll(gardenId:with:)` it requires — the
/// P5-IOS-02 (Stage 4e) counterpart to `FeaturePlantsTests.PlantOfflineMutationTests`
/// (single-record projection) and `FeatureMapTests.MapOfflineMutationTests`
/// (garden-scoped `replaceAll`), following the same approach: a real GRDB
/// database built from `LocalDatabase.migrator`, not a store double, so a
/// passing test proves the actual SQLite transaction behavior, not a mock's
/// approximation of it.
@Suite("Task offline mutation (GRDB)")
struct TaskOfflineMutationTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func task(
        id: String,
        gardenId: String = "garden-1",
        title: String = "Water the tomatoes",
        status: TaskStatus = .planned,
        revision: Int = 1
    ) -> GardenTask {
        GardenTask(
            id: id, gardenId: gardenId, targetKind: .garden, targetGardenAreaMapObjectId: nil, targetPlantId: nil,
            title: title, notes: nil, status: status, dueDate: nil, timeWindowStart: nil, timeWindowEnd: nil,
            recurrenceRule: nil, urgency: .normal, source: .manual, originObservationId: nil, revision: revision,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0), completedAt: nil
        )
    }

    /// `targetRecordIds` names the task itself, per `taskId`'s own default —
    /// a task's own id, not `gardenId` (the *owning* garden, shared by every
    /// task in it), is what `GRDBTaskStore`'s pending check decodes, the
    /// same distinction `PlantOfflineMutationTests`'s own operation helper
    /// draws for `plant`.
    private func operation(
        id: String,
        taskId: String,
        gardenId: String = "garden-1",
        commandType: String = "tasks.createManualTask",
        expectedRevision: Int? = nil
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: commandType,
            commandVersion: 1,
            targetRecordIds: [taskId],
            expectedRevision: expectedRevision,
            payload: #"{"recordType":"task"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("commitOfflineMutation writes the projection and the outbox operation in the same transaction")
    func commitWritesBothTables() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let projection = task(id: "task-1")
        let result = try await store.commitOfflineMutation(taskId: "task-1") { current in
            #expect(current == nil)
            return (projection, self.operation(id: "op-1", taskId: "task-1"))
        }

        #expect(result == projection)

        let stored = try await store.fetchAll(gardenId: "garden-1")
        #expect(stored == [projection])

        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["op-1"])
        #expect(storedOperations.first?.localSequence == 1)
        #expect(storedOperations.first?.gardenId == "garden-1")
        #expect(storedOperations.first?.targetRecordIds == ["task-1"])
    }

    @Test("commitOfflineMutation loads the current record from inside the same transaction")
    func commitLoadsCurrentRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(taskId: "task-1") { current in
            #expect(current == nil)
            return (
                self.task(id: "task-1", title: "Water the tomatoes"),
                self.operation(id: "op-1", taskId: "task-1")
            )
        }

        let edited = try await store.commitOfflineMutation(taskId: "task-1") { current in
            #expect(current?.title == "Water the tomatoes")
            let updated = self.task(id: "task-1", title: "Water the tomatoes deeply")
            return (
                updated,
                self.operation(id: "op-2", taskId: "task-1", commandType: "tasks.editTask", expectedRevision: 1)
            )
        }

        #expect(edited.title == "Water the tomatoes deeply")
    }

    @Test("A thrown validation error inside the command writes nothing")
    func throwingCommandWritesNothing() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        let failure = await #expect(throws: TaskCommandError.self) {
            try await store.commitOfflineMutation(taskId: "task-1") { _ in
                throw TaskCommandError.invalidTitle
            }
        }

        #expect(failure == .invalidTitle)
        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
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
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        // A real prior row occupying the operation ID the second commit will
        // try to reuse.
        try await outbox.enqueue(operation(id: "duplicate-op", taskId: "task-0"))

        let failure = await #expect(throws: (any Error).self) {
            try await store.commitOfflineMutation(taskId: "task-1") { _ in
                (self.task(id: "task-1"), self.operation(id: "duplicate-op", taskId: "task-1"))
            }
        }
        #expect(failure != nil)

        // The projection write ran first inside the same transaction as the
        // failed outbox insert — if it had survived independently, this
        // would find "task-1".
        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)

        // The pre-existing row is untouched, and no second row was created
        // under the same id.
        let storedOperations = try await outbox.fetchAll()
        #expect(storedOperations.map(\.id) == ["duplicate-op"])
        #expect(storedOperations.first?.targetRecordIds == ["task-0"])
    }

    /// The positive half of the termination-at-boundary evidence: once
    /// `commitOfflineMutation` returns, both writes are durably present
    /// together — if the process were to terminate at any point afterward,
    /// there is no partially-applied state to recover from.
    @Test("After a successful commit, both the projection and the outbox operation are durably present")
    func successfulCommitLeavesBothWritesDurable() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        _ = try await store.commitOfflineMutation(taskId: "task-1") { _ in
            (self.task(id: "task-1"), self.operation(id: "op-1", taskId: "task-1"))
        }

        // Independently reopened stores against the same file-backed queue
        // read back what actually committed to disk, not in-process state.
        let rereadStore = GRDBTaskStore(dbQueue: dbQueue)
        let rereadOutbox = GRDBSyncOutboxStore(dbQueue: dbQueue)

        #expect(try await rereadStore.fetchAll(gardenId: "garden-1").map(\.id) == ["task-1"])
        #expect(try await rereadOutbox.fetchAll().map(\.id) == ["op-1"])
    }

    @Test("replaceAll preserves a task with a pending outbox operation")
    func replaceAllPreservesPendingTask() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)

        let pending = task(id: "task-1", title: "Not synced yet")
        _ = try await store.commitOfflineMutation(taskId: "task-1") { _ in
            (pending, self.operation(id: "op-1", taskId: "task-1"))
        }

        // The server's (necessarily stale) view of the same garden's tasks.
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", title: "Stale server title")])

        #expect(try await store.fetchAll(gardenId: "garden-1").first?.title == "Not synced yet")
    }

    @Test("replaceAll writes normally when nothing is pending for the garden")
    func replaceAllWritesWhenNotPending() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)

        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", title: "Confirmed")])

        #expect(try await store.fetchAll(gardenId: "garden-1").first?.title == "Confirmed")
    }

    @Test("replaceAll only protects the task named by a pending operation's targetRecordIds, not the whole garden")
    func replaceAllPendingIsScopedPerTask() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)

        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1"), task(id: "task-2")])
        let pending = task(id: "task-1", title: "Not synced yet")
        _ = try await store.commitOfflineMutation(taskId: "task-1") { _ in
            (pending, self.operation(id: "op-1", taskId: "task-1"))
        }

        // A second, unrelated task in the SAME garden has no pending
        // operation of its own — a server response for it must still land,
        // including deleting it if the server no longer returns it.
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", title: "Stale server title")])

        let remaining = try await store.fetchAll(gardenId: "garden-1")
        #expect(remaining.count == 1)
        #expect(remaining.first?.id == "task-1")
        #expect(remaining.first?.title == "Not synced yet")
    }

    @Test("fetchAll is scoped by gardenId")
    func fetchAllScopedByGarden() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)

        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", gardenId: "garden-1")])
        try await store.replaceAll(gardenId: "garden-2", with: [task(id: "task-2", gardenId: "garden-2")])

        #expect(try await store.fetchAll(gardenId: "garden-1").map(\.id) == ["task-1"])
        #expect(try await store.fetchAll(gardenId: "garden-2").map(\.id) == ["task-2"])
    }
}
