import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureTasks

/// As of P5-IOS-02 (Stage 4e), every one of `TasksListViewModel`'s seven
/// mutating actions routes through `LocalTaskStore.commitOfflineMutation` —
/// no network call, see `TasksUseCases.swift`'s doc comment. `FakeTaskGateway`
/// is still needed for `listTasksForGarden`, the one remaining online,
/// gateway-backed read `ListTasksForGarden` wraps and write-throughs into
/// `LocalTaskStore` — so seeding `FakeTaskGateway` with a task and calling
/// `load()` once is what gives the seven offline commands a local row to
/// mutate, mirroring how a real device would only ever have a local `task`
/// row for something it already fetched (or created) at least once.
@MainActor
@Suite("Tasks list view model")
struct TasksListViewModelTests {
    private func task(id: String = "task-1", status: TaskStatus = .planned, revision: Int = 1) -> GardenTask {
        GardenTask(
            id: id, gardenId: "garden-1", targetKind: .garden, targetGardenAreaMapObjectId: nil, targetPlantId: nil,
            title: "Water the tomatoes", notes: nil, status: status, dueDate: nil, timeWindowStart: nil,
            timeWindowEnd: nil, recurrenceRule: nil, urgency: .normal, source: .manual, originObservationId: nil,
            revision: revision, createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0), completedAt: nil
        )
    }

    private func makeModel(
        gateway: FakeTaskGateway,
        localStore: any LocalTaskStore = InMemoryTaskStore()
    ) -> TasksListViewModel {
        TasksListViewModel(
            gardenId: "garden-1",
            createManualTask: CreateManualTask(localStore: localStore, profileId: "profile-1"),
            listTasksForGarden: ListTasksForGarden(gateway: gateway, localStore: localStore),
            editTask: EditTask(localStore: localStore, profileId: "profile-1"),
            rescheduleTask: RescheduleTask(localStore: localStore, profileId: "profile-1"),
            completeTask: CompleteTask(localStore: localStore, profileId: "profile-1"),
            dismissTask: DismissTask(localStore: localStore, profileId: "profile-1"),
            skipTask: SkipTask(localStore: localStore, profileId: "profile-1"),
            deleteTask: DeleteTask(localStore: localStore, profileId: "profile-1"),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("load with no filter lists every status")
    func loadWithNoFilterListsEverything() async {
        let gateway = FakeTaskGateway(tasks: [task(id: "task-1", status: .planned), task(id: "task-2", status: .completed)])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 2)
    }

    @Test("load with a status filter lists only that status, applied client-side over the unfiltered fetch")
    func loadWithFilterListsOnlyThatStatus() async {
        let gateway = FakeTaskGateway(tasks: [task(id: "task-1", status: .planned), task(id: "task-2", status: .completed)])
        let model = makeModel(gateway: gateway)
        model.statusFilter = .completed

        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.count == 1)
        #expect(rows.first?.id == "task-2")
    }

    @Test("A row's isMutable reflects TaskStatus.isMutable")
    func rowIsMutableReflectsStatus() async {
        let gateway = FakeTaskGateway(tasks: [task(id: "task-1", status: .planned), task(id: "task-2", status: .completed)])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.first { $0.id == "task-1" }?.isMutable == true)
        #expect(rows.first { $0.id == "task-2" }?.isMutable == false)
    }

    @Test("submitCreateTask rejects an empty title without writing anything locally")
    func submitCreateRejectsEmptyTitle() async throws {
        let localStore = InMemoryTaskStore()
        let gateway = FakeTaskGateway()
        let model = makeModel(gateway: gateway, localStore: localStore)
        model.createTitle = "   "

        await model.submitCreateTask()

        #expect(model.createErrorMessage != nil)
        #expect(try await localStore.fetchAll(gardenId: "garden-1").isEmpty)
    }

    @Test("submitCreateTask rejects a garden-area target with no id")
    func submitCreateRejectsGardenAreaWithoutId() async {
        let gateway = FakeTaskGateway()
        let model = makeModel(gateway: gateway)
        model.createTitle = "Weed the bed"
        model.createTargetKind = .gardenArea
        model.createTargetGardenAreaMapObjectId = ""

        await model.submitCreateTask()

        #expect(model.createErrorMessage != nil)
    }

    @Test("submitCreateTask succeeds locally and resets the form, without calling the gateway")
    func submitCreateSucceeds() async {
        let gateway = FakeTaskGateway()
        let model = makeModel(gateway: gateway)
        model.createTitle = "Water the tomatoes"

        await model.submitCreateTask()

        #expect(model.createErrorMessage == nil)
        #expect(model.createTitle.isEmpty)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state after reload")
            return
        }
        #expect(rows.count == 1)
        #expect(rows.first?.isPendingSync == true)
        // `FakeTaskGateway` never learned about this task — if
        // `CreateManualTask` had called through to it, `listTasksForGarden`
        // (which reads the same in-memory dictionary it would have
        // populated) would return it too.
        let confirmed = try? await gateway.listTasksForGarden(gardenId: "garden-1", statuses: [])
        #expect(confirmed?.isEmpty == true)
    }

    @Test("complete transitions a planned task to completed, without calling the gateway")
    func completeTransitionsToCompleted() async {
        let gateway = FakeTaskGateway(tasks: [task()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.complete(taskId: "task-1")

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.first?.status == .completed)
        #expect(rows.first?.isPendingSync == true)
        // The fake gateway's own copy is untouched — a real network call
        // would have advanced its `revision`/`status` too.
        let confirmed = try? await gateway.listTasksForGarden(gardenId: "garden-1", statuses: [])
        #expect(confirmed?.first?.status == .planned)
    }

    @Test("delete transitions to deleted — a status transition, never a hard delete")
    func deleteTransitionsToDeleted() async {
        let gateway = FakeTaskGateway(tasks: [task()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.delete(taskId: "task-1")

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        // Still present, with status `deleted` — never removed from the
        // list, since `DeleteTask` is a status transition, never a row
        // deletion.
        #expect(rows.count == 1)
        #expect(rows.first?.status == .deleted)
    }

    @Test("A row action on an already-terminal task is a no-op, guarded before the local commit")
    func rowActionOnTerminalTaskIsNoOp() async {
        let gateway = FakeTaskGateway(tasks: [task(status: .completed)])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.skip(taskId: "task-1")

        // No error surfaced and no state change — the guard in
        // `performRowAction` returns before ever calling the local store.
        #expect(model.rowActionErrorMessage == nil)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.first?.status == .completed)
    }

    @Test("submitEdit updates the task and closes the edit sheet")
    func submitEditUpdatesTaskAndClosesSheet() async {
        let gateway = FakeTaskGateway(tasks: [task()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.editingTaskId = "task-1"

        await model.submitEdit(
            taskId: "task-1",
            title: "Water the tomatoes deeply",
            notes: .set("Use the soaker hose"),
            dueDate: .unchanged,
            timeWindowStart: .unchanged,
            timeWindowEnd: .unchanged,
            urgency: .high
        )

        #expect(model.editingTaskId == nil)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.first?.title == "Water the tomatoes deeply")
        #expect(rows.first?.urgencyLabel == model.urgencyName(.high))
    }

    @Test("submitReschedule sets a new due date and closes the reschedule sheet")
    func submitRescheduleSetsDueDate() async {
        let gateway = FakeTaskGateway(tasks: [task()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.reschedulingTaskId = "task-1"

        await model.submitReschedule(
            taskId: "task-1", dueDate: .set("2026-08-01"), timeWindowStart: .unchanged, timeWindowEnd: .unchanged
        )

        #expect(model.reschedulingTaskId == nil)
        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.first?.dueDateText == "2026-08-01")
    }

    @Test("a pending local mutation survives a subsequent network refresh instead of being clobbered by the stale server response")
    func pendingMutationSurvivesRefresh() async {
        let gateway = FakeTaskGateway(tasks: [task()])
        let model = makeModel(gateway: gateway)
        await model.load()
        await model.complete(taskId: "task-1")

        // A second `load()` — the fake gateway's own copy is still `planned`
        // (necessarily stale, since nothing has actually pushed this
        // client's completion to it yet).
        await model.load()

        guard case let .loaded(rows) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(rows.first?.status == .completed)
    }
}
