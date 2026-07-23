import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureTasks

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

    private func makeModel(gateway: FakeTaskGateway) -> TasksListViewModel {
        TasksListViewModel(
            gardenId: "garden-1",
            createManualTask: CreateManualTask(gateway: gateway),
            listTasksForGarden: ListTasksForGarden(gateway: gateway),
            editTask: EditTask(gateway: gateway),
            rescheduleTask: RescheduleTask(gateway: gateway),
            completeTask: CompleteTask(gateway: gateway),
            dismissTask: DismissTask(gateway: gateway),
            skipTask: SkipTask(gateway: gateway),
            deleteTask: DeleteTask(gateway: gateway),
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

    @Test("load with a status filter lists only that status")
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

    @Test("submitCreateTask rejects an empty title without calling the gateway")
    func submitCreateRejectsEmptyTitle() async {
        let gateway = FakeTaskGateway()
        let model = makeModel(gateway: gateway)
        model.createTitle = "   "

        await model.submitCreateTask()

        #expect(model.createErrorMessage != nil)
        let tasks = try? await gateway.listTasksForGarden(gardenId: "garden-1", statuses: [])
        #expect(tasks?.isEmpty == true)
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

    @Test("submitCreateTask succeeds and resets the form")
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
    }

    @Test("complete transitions a planned task to completed")
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
        #expect(rows.first?.status == .deleted)
    }

    @Test("A row action on an already-terminal task is a no-op, guarded before the network call")
    func rowActionOnTerminalTaskIsNoOp() async {
        let gateway = FakeTaskGateway(tasks: [task(status: .completed)])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.skip(taskId: "task-1")

        // No error surfaced and no state change — the guard in
        // `performRowAction` returns before ever calling the gateway.
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
}
