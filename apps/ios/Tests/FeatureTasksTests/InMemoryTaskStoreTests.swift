import CoreDomain
import Foundation
import Testing

@testable import FeatureTasks

@Suite("In-memory task store")
struct InMemoryTaskStoreTests {
    private func task(id: String, gardenId: String = "garden-1", title: String = "Water the tomatoes") -> GardenTask {
        GardenTask(
            id: id, gardenId: gardenId, targetKind: .garden, targetGardenAreaMapObjectId: nil, targetPlantId: nil,
            title: title, notes: nil, status: .planned, dueDate: nil, timeWindowStart: nil, timeWindowEnd: nil,
            recurrenceRule: nil, urgency: .normal, source: .manual, originObservationId: nil, revision: 1,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0), completedAt: nil
        )
    }

    private func operation(id: String, taskId: String, gardenId: String = "garden-1") -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: gardenId,
            commandType: "tasks.createManualTask",
            commandVersion: 1,
            targetRecordIds: [taskId],
            expectedRevision: nil,
            payload: #"{"recordType":"task"}"#,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("Starts empty")
    func startsEmpty() async throws {
        let store = InMemoryTaskStore()
        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
    }

    @Test("replaceAll replaces the whole per-garden set")
    func replaceAllReplacesGardenSet() async throws {
        let store = InMemoryTaskStore()
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "1", title: "First")])
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "1", title: "Renamed")])

        #expect(try await store.fetchAll(gardenId: "garden-1").map(\.title) == ["Renamed"])
    }

    @Test("commitOfflineMutation applies the projection and hands the current record to the command")
    func commitOfflineMutationAppliesProjection() async throws {
        let store = InMemoryTaskStore()
        let created = task(id: "1", title: "Water the tomatoes")

        let result = try await store.commitOfflineMutation(taskId: "1") { current in
            #expect(current == nil)
            return (created, operation(id: "op-1", taskId: "1"))
        }

        #expect(result == created)
        #expect(try await store.fetchAll(gardenId: "garden-1") == [created])
    }

    @Test("replaceAll skips overwriting a task with a pending offline mutation")
    func replaceAllSkipsPendingTask() async throws {
        let store = InMemoryTaskStore()
        let pending = task(id: "1", title: "Renamed locally")
        _ = try await store.commitOfflineMutation(taskId: "1") { _ in
            (pending, operation(id: "op-1", taskId: "1"))
        }

        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "1", title: "Stale server title")])

        #expect(try await store.fetchAll(gardenId: "garden-1").first?.title == "Renamed locally")
    }

    @Test("replaceAll writes normally for a garden with no pending offline mutation")
    func replaceAllWritesWhenNotPending() async throws {
        let store = InMemoryTaskStore()
        let pending = task(id: "1", gardenId: "garden-1", title: "Renamed locally")
        _ = try await store.commitOfflineMutation(taskId: "1") { _ in
            (pending, operation(id: "op-1", taskId: "1"))
        }

        // A second, unrelated garden has no pending mutation of its own.
        try await store.replaceAll(gardenId: "garden-2", with: [task(id: "2", gardenId: "garden-2", title: "From server")])

        #expect(try await store.fetchAll(gardenId: "garden-2").first?.title == "From server")
    }

    @Test("fetchAll is scoped by gardenId")
    func fetchAllScopedByGarden() async throws {
        let store = InMemoryTaskStore()
        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "1", gardenId: "garden-1")])
        try await store.replaceAll(gardenId: "garden-2", with: [task(id: "2", gardenId: "garden-2")])

        #expect(try await store.fetchAll(gardenId: "garden-1").map(\.id) == ["1"])
        #expect(try await store.fetchAll(gardenId: "garden-2").map(\.id) == ["2"])
    }

    @Test("confirmSynced advances the revision and lifts the pending guard, without touching other fields")
    func confirmSyncedAdvancesRevisionAndLiftsPendingGuard() async throws {
        let store = InMemoryTaskStore()
        let pending = task(id: "1", title: "Renamed locally")
        _ = try await store.commitOfflineMutation(taskId: "1") { _ in
            (pending, operation(id: "op-1", taskId: "1"))
        }

        try await store.confirmSynced(taskId: "1", revision: 5)

        let confirmed = try #require(await store.fetchAll(gardenId: "garden-1").first)
        #expect(confirmed.title == "Renamed locally")
        #expect(confirmed.revision == 5)

        try await store.replaceAll(gardenId: "garden-1", with: [task(id: "1", title: "From server")])
        #expect(try await store.fetchAll(gardenId: "garden-1").first?.title == "From server")
    }

    @Test("confirmSynced is a silent no-op for a task this device has no local row for")
    func confirmSyncedNoOpForUnknownTask() async throws {
        let store = InMemoryTaskStore()
        try await store.confirmSynced(taskId: "unknown", revision: 3)
        #expect(try await store.fetchAll(gardenId: "garden-1").isEmpty)
    }
}
