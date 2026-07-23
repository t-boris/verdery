import CoreDomain
import CoreNetworking
import Foundation

/// Row-level actions: complete, skip, dismiss, delete (all plain status
/// transitions with no data of their own beyond the revision), and edit /
/// reschedule (which need a small form, so they only prepare the sheet's
/// initial values here — the submit itself is `submitEdit`/`submitReschedule`
/// below).
///
/// Every one of these guards on ``TaskRow/isMutable`` (mirrored from
/// `TaskStatus.isMutable`) before calling the network, the same
/// "only while planned/suggested" rule the view hides the row's action
/// controls for — this is the same defensive re-check
/// `MapEditorViewModelEditing.createObject`'s gate-creation handling
/// documents doing for a UI control that could reach here regardless.
extension TasksListViewModel {
    public func complete(taskId: String) async {
        await performRowAction(taskId: taskId) { [self] task in
            try await completeTask(gardenId: gardenId, taskId: taskId, expectedRevision: task.revision)
        }
    }

    public func skip(taskId: String) async {
        await performRowAction(taskId: taskId) { [self] task in
            try await skipTask(gardenId: gardenId, taskId: taskId, expectedRevision: task.revision)
        }
    }

    public func dismiss(taskId: String) async {
        await performRowAction(taskId: taskId) { [self] task in
            try await dismissTask(gardenId: gardenId, taskId: taskId, expectedRevision: task.revision)
        }
    }

    /// The list's "Delete" affordance: a status transition to `'deleted'`,
    /// not a hard delete — there is no `DELETE` endpoint for a task.
    public func delete(taskId: String) async {
        await performRowAction(taskId: taskId) { [self] task in
            try await deleteTask(gardenId: gardenId, taskId: taskId, expectedRevision: task.revision)
        }
    }

    public func submitEdit(
        taskId: String,
        title: String,
        notes: FieldUpdate<String>,
        dueDate: FieldUpdate<String>,
        timeWindowStart: FieldUpdate<Date>,
        timeWindowEnd: FieldUpdate<Date>,
        urgency: TaskUrgency
    ) async {
        await performRowAction(taskId: taskId) { [self] task in
            try await editTask(
                gardenId: gardenId,
                taskId: taskId,
                title: title,
                notes: notes,
                dueDate: dueDate,
                timeWindowStart: timeWindowStart,
                timeWindowEnd: timeWindowEnd,
                urgency: urgency,
                expectedRevision: task.revision
            )
        }
        editingTaskId = nil
    }

    public func submitReschedule(
        taskId: String,
        dueDate: FieldUpdate<String>,
        timeWindowStart: FieldUpdate<Date>,
        timeWindowEnd: FieldUpdate<Date>
    ) async {
        await performRowAction(taskId: taskId) { [self] task in
            try await rescheduleTask(
                gardenId: gardenId,
                taskId: taskId,
                dueDate: dueDate,
                timeWindowStart: timeWindowStart,
                timeWindowEnd: timeWindowEnd,
                expectedRevision: task.revision
            )
        }
        reschedulingTaskId = nil
    }

    private func performRowAction(taskId: String, _ action: (GardenTask) async throws -> GardenTask) async {
        guard let task = tasksById[taskId], task.status.isMutable else { return }

        isPerformingRowAction = true
        rowActionErrorMessage = nil
        defer { isPerformingRowAction = false }

        do {
            _ = try await action(task)
            await load()
        } catch let error as APIGatewayError {
            rowActionErrorMessage = message(for: error)
        } catch {
            rowActionErrorMessage = strings(.serverUnexpected)
        }
    }
}
