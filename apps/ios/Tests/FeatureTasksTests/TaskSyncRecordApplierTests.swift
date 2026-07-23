import CoreDomain
import CoreSynchronization
import Foundation
import Testing

@testable import FeatureTasks

/// Proves `TaskSyncRecordApplier` forwards `applyConfirmed` to
/// `LocalTaskStore.confirmSynced(taskId:revision:)` with the right
/// parameter mapping (`recordId` → `taskId`), through a real
/// `InMemoryTaskStore` — the same "fake/in-memory local store proving the
/// right store method gets called" coverage this work package calls for.
@Suite("Task sync record applier")
struct TaskSyncRecordApplierTests {
    private func task(id: String, revision: Int = 1) -> GardenTask {
        GardenTask(
            id: id, gardenId: "garden-1", targetKind: .garden, targetGardenAreaMapObjectId: nil, targetPlantId: nil,
            title: "Water the tomatoes", notes: nil, status: .planned, dueDate: nil, timeWindowStart: nil,
            timeWindowEnd: nil, recurrenceRule: nil, urgency: .normal, source: .manual, originObservationId: nil,
            revision: revision, createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0), completedAt: nil
        )
    }

    @Test("recordType is 'task', matching the contract's SyncRecordType")
    func recordTypeIsTask() {
        let applier = TaskSyncRecordApplier(localStore: InMemoryTaskStore())
        #expect(applier.recordType == "task")
    }

    @Test("applyConfirmed advances the task's revision through the local store")
    func applyConfirmedAdvancesRevision() async throws {
        let store = InMemoryTaskStore()
        _ = try await store.commitOfflineMutation(taskId: "task-1") { _ in
            (task(id: "task-1"), OutboxOperation(
                id: "op-1", profileId: "profile-1", gardenId: "garden-1", commandType: "tasks.createManualTask",
                commandVersion: 1, targetRecordIds: ["task-1"], expectedRevision: nil,
                payload: #"{"recordType":"task"}"#, createdAt: Date(timeIntervalSince1970: 0)
            ))
        }
        let applier = TaskSyncRecordApplier(localStore: store)

        try await applier.applyConfirmed(recordId: "task-1", revision: 2, confirmedAt: Date())

        #expect(try await store.fetchAll(gardenId: "garden-1").first?.revision == 2)
    }
}
