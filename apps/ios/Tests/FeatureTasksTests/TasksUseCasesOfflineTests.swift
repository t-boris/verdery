import CoreDomain
import CoreNetworking
import Foundation
import GRDB
import Testing

@testable import CorePersistence
@testable import FeatureTasks

/// Coverage for the seven offline-capable task commands (`CreateManualTask`,
/// `EditTask`, `RescheduleTask`, `CompleteTask`, `DismissTask`, `SkipTask`,
/// `DeleteTask`) against a real GRDB database, per architecture/offline-
/// synchronization.md, section "6. Local Mutation Transaction" — the
/// P5-IOS-02 (Stage 4e) counterpart to `FeaturePlantsTests.PlantsUseCasesOfflineTests`.
///
/// None of these tests configure a `TaskGateway` at all — the seven use
/// cases no longer accept one (see `TasksUseCases.swift`) — so a passing
/// suite is itself evidence that creating, editing, rescheduling,
/// completing, dismissing, skipping, or deleting a task while offline never
/// attempts a network call.
@Suite("Task use cases (offline)")
struct TasksUseCasesOfflineTests {
    private func makeDatabase() throws -> DatabaseQueue {
        let dbQueue = try DatabaseQueue()
        try LocalDatabase.migrator.migrate(dbQueue)
        return dbQueue
    }

    private func task(
        id: String,
        gardenId: String = "garden-1",
        title: String = "Water the tomatoes",
        notes: String? = nil,
        status: TaskStatus = .planned,
        dueDate: String? = nil,
        urgency: TaskUrgency = .normal,
        revision: Int = 3
    ) -> GardenTask {
        GardenTask(
            id: id, gardenId: gardenId, targetKind: .garden, targetGardenAreaMapObjectId: nil, targetPlantId: nil,
            title: title, notes: notes, status: status, dueDate: dueDate, timeWindowStart: nil, timeWindowEnd: nil,
            recurrenceRule: nil, urgency: urgency, source: .manual, originObservationId: nil, revision: revision,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0), completedAt: nil
        )
    }

    /// Decodes an outbox row's stored `payload` as loose JSON, so a test can
    /// assert it matches `packages/api-contracts/openapi.yaml`'s
    /// `SyncTaskOperationPayload`/`SyncTaskCommand` field-for-field without
    /// needing a real server or the generated OpenAPI models — mirrors
    /// `PlantsUseCasesOfflineTests.decodedPayloadJSON`'s identical purpose.
    private func decodedPayloadJSON(_ operation: OutboxOperation) throws -> [String: Any] {
        let object = try JSONSerialization.jsonObject(with: Data(operation.payload.utf8))
        return try #require(object as? [String: Any])
    }

    // MARK: - CreateManualTask

    @Test("CreateManualTask writes a local projection and a tasks.createManualTask outbox row")
    func createManualTaskOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        let createManualTask = CreateManualTask(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 1_000) },
            generateOperationId: { "operation-1" },
            generateTaskId: { "task-1" }
        )

        let result = try await createManualTask(
            gardenId: "garden-1",
            targetKind: .plant,
            targetPlantId: "plant-1",
            title: "  Water the tomatoes  ",
            notes: "Use the soaker hose",
            dueDate: "2026-08-01",
            urgency: .high,
            originObservationId: "obs-1"
        )

        #expect(result.id == "task-1")
        #expect(result.gardenId == "garden-1")
        #expect(result.targetKind == .plant)
        #expect(result.targetPlantId == "plant-1")
        #expect(result.title == "Water the tomatoes")
        #expect(result.status == .planned)
        #expect(result.source == .manual)
        #expect(result.urgency == .high)
        // Below the contract's `Revision` minimum of 1 — can never be
        // mistaken for a real server revision.
        #expect(result.revision == 0)

        let stored = try await store.fetchAll(gardenId: "garden-1")
        #expect(stored == [result])

        let operations = try await outbox.fetchAll()
        let operation = try #require(operations.first)
        #expect(operations.count == 1)
        #expect(operation.id == "operation-1")
        #expect(operation.profileId == "profile-1")
        #expect(operation.gardenId == "garden-1")
        #expect(operation.commandType == "tasks.createManualTask")
        #expect(operation.commandVersion == 1)
        #expect(operation.targetRecordIds == ["task-1"])
        #expect(operation.expectedRevision == nil)

        let json = try decodedPayloadJSON(operation)
        #expect(json["recordType"] as? String == "task")
        #expect(json["gardenId"] as? String == "garden-1")
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "tasks.createManualTask")
        #expect(command["taskId"] as? String == "task-1")
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["title"] as? String == "Water the tomatoes")
        #expect(request["dueDate"] as? String == "2026-08-01")
        #expect(request["urgency"] as? String == "high")
        #expect(request["originObservationId"] as? String == "obs-1")
        let target = try #require(request["target"] as? [String: Any])
        #expect(target["kind"] as? String == "plant")
        #expect(target["plantId"] as? String == "plant-1")
    }

    @Test("CreateManualTask defaults urgency to normal, matching the server's own default")
    func createManualTaskDefaultsUrgency() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let createManualTask = CreateManualTask(localStore: store, profileId: "profile-1")

        let result = try await createManualTask(gardenId: "garden-1", targetKind: .garden, title: "Weed the bed")

        #expect(result.urgency == .normal)
    }

    @Test("CreateManualTask rejects an empty title without writing anything")
    func createManualTaskRejectsEmptyTitle() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let createManualTask = CreateManualTask(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: TaskCommandError.self) {
            try await createManualTask(gardenId: "garden-1", targetKind: .garden, title: "   ")
        }

        #expect(failure == .invalidTitle)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }

    @Test("CreateManualTask rejects a title longer than 200 characters")
    func createManualTaskRejectsTooLongTitle() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let createManualTask = CreateManualTask(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: TaskCommandError.self) {
            try await createManualTask(gardenId: "garden-1", targetKind: .garden, title: String(repeating: "a", count: 201))
        }

        #expect(failure == .invalidTitle)
    }

    // MARK: - EditTask

    @Test("EditTask writes a local projection and a tasks.editTask outbox row, revision unchanged")
    func editTaskOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", title: "Water the tomatoes", revision: 4)])

        let editTask = EditTask(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 2_000) },
            generateOperationId: { "operation-2" }
        )

        let result = try await editTask(
            gardenId: "garden-1",
            taskId: "task-1",
            title: "Water the tomatoes deeply",
            notes: .set("Use the soaker hose"),
            urgency: .high,
            expectedRevision: 4
        )

        #expect(result.title == "Water the tomatoes deeply")
        #expect(result.notes == "Use the soaker hose")
        #expect(result.urgency == .high)
        // Unchanged locally: the server, not this client, assigns the next
        // revision.
        #expect(result.revision == 4)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "tasks.editTask")
        #expect(operation.expectedRevision == 4)
        #expect(operation.gardenId == "garden-1")
        #expect(operation.targetRecordIds == ["task-1"])

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "tasks.editTask")
        #expect(command["expectedRevision"] as? Int == 4)
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["title"] as? String == "Water the tomatoes deeply")
        #expect(request["notes"] as? String == "Use the soaker hose")
        #expect(request["urgency"] as? String == "high")
        // `.unchanged` fields are omitted entirely — `dueDate` was never
        // passed, so it stays `.unchanged` by default.
        #expect(request.keys.contains("dueDate") == false)
    }

    @Test("EditTask encodes .set(nil) as an explicit null, not an omitted key")
    func editTaskEncodesExplicitNull() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", notes: "Old note")])

        let editTask = EditTask(localStore: store, profileId: "profile-1")

        _ = try await editTask(gardenId: "garden-1", taskId: "task-1", notes: .set(nil), expectedRevision: 3)

        let operation = try #require(try await outbox.fetchAll().first)
        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        let request = try #require(command["request"] as? [String: Any])
        #expect(request.keys.contains("notes"))
        #expect(request["notes"] is NSNull)
    }

    @Test("EditTask fails locally when this device has no local record for the task")
    func editTaskWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let editTask = EditTask(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: TaskCommandError.self) {
            try await editTask(gardenId: "garden-1", taskId: "unknown-task", expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
        #expect(try await GRDBSyncOutboxStore(dbQueue: dbQueue).fetchAll().isEmpty)
    }

    @Test("EditTask rejects an empty title without writing anything")
    func editTaskRejectsEmptyTitle() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1")])
        let editTask = EditTask(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: TaskCommandError.self) {
            try await editTask(gardenId: "garden-1", taskId: "task-1", title: "  ", expectedRevision: 3)
        }

        #expect(failure == .invalidTitle)
        #expect(try await store.fetchAll(gardenId: "garden-1").first?.title == "Water the tomatoes")
    }

    @Test("EditTask fails locally when the task is not planned/suggested")
    func editTaskRejectsTerminalStatus() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", status: .completed)])
        let editTask = EditTask(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: TaskCommandError.self) {
            try await editTask(gardenId: "garden-1", taskId: "task-1", title: "New title", expectedRevision: 3)
        }

        #expect(failure == .taskNotEditable)
    }

    // MARK: - RescheduleTask

    @Test("RescheduleTask writes a local projection and a tasks.rescheduleTask outbox row, touching only the schedule")
    func rescheduleTaskOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.replaceAll(
            gardenId: "garden-1",
            with: [task(id: "task-1", title: "Water the tomatoes", dueDate: "2026-07-01", revision: 5)]
        )

        let rescheduleTask = RescheduleTask(
            localStore: store,
            profileId: "profile-1",
            generateOperationId: { "operation-3" }
        )

        let result = try await rescheduleTask(gardenId: "garden-1", taskId: "task-1", dueDate: .set("2026-08-01"), expectedRevision: 5)

        #expect(result.dueDate == "2026-08-01")
        // `title` is untouched — `RescheduleTask` never sets it.
        #expect(result.title == "Water the tomatoes")
        #expect(result.revision == 5)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "tasks.rescheduleTask")
        #expect(operation.expectedRevision == 5)

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "tasks.rescheduleTask")
        let request = try #require(command["request"] as? [String: Any])
        #expect(request["dueDate"] as? String == "2026-08-01")
        // `RescheduleTaskRequest` has no `title`/`urgency`/etc keys at all.
        #expect(request.keys.contains("title") == false)
    }

    @Test("RescheduleTask fails locally when this device has no local record for the task")
    func rescheduleTaskWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let rescheduleTask = RescheduleTask(localStore: store, profileId: "profile-1")

        let failure = await #expect(throws: TaskCommandError.self) {
            try await rescheduleTask(gardenId: "garden-1", taskId: "unknown-task", expectedRevision: 1)
        }

        #expect(failure == .localRecordNotFound)
    }

    // MARK: - CompleteTask / DismissTask / SkipTask / DeleteTask

    @Test("CompleteTask transitions to completed, sets completedAt, and writes a tasks.completeTask outbox row")
    func completeTaskOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", revision: 6)])

        let completeTask = CompleteTask(
            localStore: store,
            profileId: "profile-1",
            now: { Date(timeIntervalSince1970: 3_000) },
            generateOperationId: { "operation-4" }
        )

        let result = try await completeTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 6)

        #expect(result.status == .completed)
        #expect(result.completedAt == Date(timeIntervalSince1970: 3_000))
        #expect(result.revision == 6)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "tasks.completeTask")
        #expect(operation.expectedRevision == 6)

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "tasks.completeTask")
        // `completionNote` is always `nil` from this client and so is
        // omitted, matching the synthesized `Encodable`'s default behavior
        // for a `nil` optional.
        let request = try #require(command["request"] as? [String: Any])
        #expect(request.keys.contains("completionNote") == false)
    }

    @Test("DismissTask transitions to dismissed and writes a tasks.dismissTask outbox row")
    func dismissTaskOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", revision: 7)])

        let dismissTask = DismissTask(localStore: store, profileId: "profile-1", generateOperationId: { "operation-5" })

        let result = try await dismissTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 7)

        #expect(result.status == .dismissed)
        // Only `.completed` ever sets `completedAt`.
        #expect(result.completedAt == nil)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "tasks.dismissTask")
    }

    @Test("SkipTask transitions to skipped and writes a tasks.skipTask outbox row with no request body")
    func skipTaskOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", revision: 8)])

        let skipTask = SkipTask(localStore: store, profileId: "profile-1", generateOperationId: { "operation-6" })

        let result = try await skipTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 8)

        #expect(result.status == .skipped)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "tasks.skipTask")

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        // `SyncSkipTaskCommand` carries no `request` property at all.
        #expect(command.keys.contains("request") == false)
    }

    @Test("DeleteTask is a status transition to deleted, not a row deletion — the row remains readable afterward")
    func deleteTaskOffline() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let outbox = GRDBSyncOutboxStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", revision: 9)])

        let deleteTask = DeleteTask(localStore: store, profileId: "profile-1", generateOperationId: { "operation-7" })

        let result = try await deleteTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 9)

        #expect(result.status == .deleted)
        // The row is still present in the local table — a normal mutable-
        // record upsert with its status changed, never a row deletion.
        let stored = try await store.fetchAll(gardenId: "garden-1")
        #expect(stored.count == 1)
        #expect(stored.first?.id == "task-1")
        #expect(stored.first?.status == .deleted)

        let operation = try #require(try await outbox.fetchAll().first)
        #expect(operation.commandType == "tasks.deleteTask")

        let json = try decodedPayloadJSON(operation)
        let command = try #require(json["command"] as? [String: Any])
        // `SyncDeleteTaskCommand` carries no `request` property at all.
        #expect(command.keys.contains("request") == false)
    }

    @Test("CompleteTask/DismissTask/SkipTask/DeleteTask all fail locally when this device has no local record for the task")
    func terminalTransitionsWithoutLocalRecord() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        let completeTask = CompleteTask(localStore: store, profileId: "profile-1")
        let dismissTask = DismissTask(localStore: store, profileId: "profile-1")
        let skipTask = SkipTask(localStore: store, profileId: "profile-1")
        let deleteTask = DeleteTask(localStore: store, profileId: "profile-1")

        await #expect(throws: TaskCommandError.localRecordNotFound) {
            try await completeTask(gardenId: "garden-1", taskId: "unknown-task", expectedRevision: 1)
        }
        await #expect(throws: TaskCommandError.localRecordNotFound) {
            try await dismissTask(gardenId: "garden-1", taskId: "unknown-task", expectedRevision: 1)
        }
        await #expect(throws: TaskCommandError.localRecordNotFound) {
            try await skipTask(gardenId: "garden-1", taskId: "unknown-task", expectedRevision: 1)
        }
        await #expect(throws: TaskCommandError.localRecordNotFound) {
            try await deleteTask(gardenId: "garden-1", taskId: "unknown-task", expectedRevision: 1)
        }
    }

    @Test("CompleteTask/DismissTask/SkipTask/DeleteTask all fail locally when the task is already terminal")
    func terminalTransitionsRejectAlreadyTerminalTask() async throws {
        let dbQueue = try makeDatabase()
        let store = GRDBTaskStore(dbQueue: dbQueue)
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "task-1", status: .deleted)])
        let completeTask = CompleteTask(localStore: store, profileId: "profile-1")
        let dismissTask = DismissTask(localStore: store, profileId: "profile-1")
        let skipTask = SkipTask(localStore: store, profileId: "profile-1")
        let deleteTask = DeleteTask(localStore: store, profileId: "profile-1")

        await #expect(throws: TaskCommandError.taskNotEditable) {
            try await completeTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 3)
        }
        await #expect(throws: TaskCommandError.taskNotEditable) {
            try await dismissTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 3)
        }
        await #expect(throws: TaskCommandError.taskNotEditable) {
            try await skipTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 3)
        }
        await #expect(throws: TaskCommandError.taskNotEditable) {
            try await deleteTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 3)
        }
    }
}
