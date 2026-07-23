import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for a garden's manual task list: create, filter by status,
/// edit, reschedule, complete, dismiss, skip, and delete.
///
/// Always fresh from the server, no local cache — see `Package.swift`'s doc
/// comment on the `FeatureTasks` target for why, the same reasoning
/// `MapEditorViewModel` documents for the map editor: every mutating
/// operation here carries a server-checked `expectedRevision`, and the list
/// also supports server-side status filtering that a local cache would have
/// to duplicate for no proven benefit at this scale.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Tasks`.
@MainActor
@Observable
public final class TasksListViewModel {
    public private(set) var state: TasksListViewState = .loading
    /// `nil` means "every status" — the contract's own default for an
    /// omitted filter.
    public var statusFilter: TaskStatus?

    // Create-task form fields.
    public var createTitle: String = ""
    public var createNotes: String = ""
    public var createTargetKind: TaskTargetKind = .garden
    /// TODO(P4-IOS-01): see `PlantsHomeViewModel`'s doc comment on the same
    /// TODO — a real map-object/plant picker is out of scope this pass for
    /// the same cross-feature-dependency and missing-list-endpoint reasons.
    public var createTargetGardenAreaMapObjectId: String = ""
    public var createTargetPlantId: String = ""
    public var createHasDueDate: Bool = false
    public var createDueDate: Date = .now
    public var createHasTimeWindow: Bool = false
    public var createTimeWindowStart: Date = .now
    public var createTimeWindowEnd: Date = .now
    public var createUrgency: TaskUrgency = .normal
    public private(set) var isSubmittingCreate = false
    public private(set) var createErrorMessage: String?

    /// Which row's action menu is open, if any.
    public var activeActionsTaskId: String?
    /// Which row's edit sheet is open, if any.
    public var editingTaskId: String?
    /// Which row's reschedule sheet is open, if any.
    public var reschedulingTaskId: String?
    // `internal(set)`, not `private(set)`: written from
    // `TasksListViewModelActions.swift`'s `performRowAction`, an extension
    // in a different file — the same reason `MapEditorViewModel`'s own
    // mutable state uses `internal(set)` rather than `private(set)` for
    // anything its topic-scoped extension files write.
    public internal(set) var isPerformingRowAction = false
    public internal(set) var rowActionErrorMessage: String?

    public let gardenId: String
    private let createManualTask: CreateManualTask
    private let listTasksForGarden: ListTasksForGarden
    let editTask: EditTask
    let rescheduleTask: RescheduleTask
    let completeTask: CompleteTask
    let dismissTask: DismissTask
    let skipTask: SkipTask
    let deleteTask: DeleteTask
    let strings: LocalizedStrings

    var tasksById: [String: GardenTask] = [:]

    public init(
        gardenId: String,
        createManualTask: CreateManualTask,
        listTasksForGarden: ListTasksForGarden,
        editTask: EditTask,
        rescheduleTask: RescheduleTask,
        completeTask: CompleteTask,
        dismissTask: DismissTask,
        skipTask: SkipTask,
        deleteTask: DeleteTask,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.createManualTask = createManualTask
        self.listTasksForGarden = listTasksForGarden
        self.editTask = editTask
        self.rescheduleTask = rescheduleTask
        self.completeTask = completeTask
        self.dismissTask = dismissTask
        self.skipTask = skipTask
        self.deleteTask = deleteTask
        self.strings = strings
    }

    public var title: String { strings(.tasksTitle) }
    public var loadingMessage: String { strings(.tasksLoading) }
    public var retryTitle: String { strings(.tasksRetry) }
    public var emptyMessage: String { strings(.tasksEmpty) }
    public var filterLabel: String { strings(.tasksFilterLabel) }
    public var filterAllLabel: String { strings(.tasksFilterAll) }
    public var createSectionTitle: String { strings(.tasksCreateSectionTitle) }
    public var titleLabel: String { strings(.tasksTitleFieldLabel) }
    public var notesLabel: String { strings(.tasksNotesLabel) }
    public var targetKindLabel: String { strings(.tasksTargetKindLabel) }
    public var targetGardenAreaLabel: String { strings(.tasksTargetGardenAreaLabel) }
    public var targetPlantLabel: String { strings(.tasksTargetPlantLabel) }
    public var mapObjectIdHint: String { strings(.tasksMapObjectIdHint) }
    public var dueDateToggleLabel: String { strings(.tasksDueDateToggle) }
    public var dueDateLabel: String { strings(.tasksDueDateLabel) }
    public var timeWindowToggleLabel: String { strings(.tasksTimeWindowToggle) }
    public var timeWindowStartLabel: String { strings(.tasksTimeWindowStartLabel) }
    public var timeWindowEndLabel: String { strings(.tasksTimeWindowEndLabel) }
    public var urgencyLabel: String { strings(.tasksUrgencyLabel) }
    public var createSubmitTitle: String { strings(.tasksCreateSubmit) }
    public var actionsTitle: String { strings(.tasksActionsTitle) }
    public var editActionTitle: String { strings(.tasksEditAction) }
    public var rescheduleActionTitle: String { strings(.tasksRescheduleAction) }
    public var completeActionTitle: String { strings(.tasksCompleteAction) }
    public var skipActionTitle: String { strings(.tasksSkipAction) }
    public var dismissActionTitle: String { strings(.tasksDismissAction) }
    public var deleteActionTitle: String { strings(.tasksDeleteAction) }
    public var cancelTitle: String { strings(.tasksCancel) }
    public var closeTitle: String { strings(.tasksClose) }

    public func targetKindName(_ kind: TaskTargetKind) -> String {
        TasksLocalization.targetKindName(kind, strings: strings)
    }

    public func statusName(_ status: TaskStatus) -> String {
        TasksLocalization.statusName(status, strings: strings)
    }

    public func urgencyName(_ urgency: TaskUrgency) -> String {
        TasksLocalization.urgencyName(urgency, strings: strings)
    }

    public func load() async {
        state = .loading

        do {
            let statuses: [TaskStatus] = statusFilter.map { [$0] } ?? []
            let tasks = try await listTasksForGarden(gardenId: gardenId, statuses: statuses)
            tasksById = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
            state = .loaded(tasks.map(row))
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    public func submitCreateTask() async {
        switch CreateTaskFormValidation.resolve(
            title: createTitle,
            targetKind: createTargetKind,
            targetGardenAreaMapObjectId: createTargetGardenAreaMapObjectId,
            targetPlantId: createTargetPlantId
        ) {
        case let .failure(failure):
            createErrorMessage = message(for: failure)
        case let .success((resolvedTitle, gardenAreaMapObjectId, plantId)):
            await performCreate(title: resolvedTitle, gardenAreaMapObjectId: gardenAreaMapObjectId, plantId: plantId)
        }
    }

    private func performCreate(title: String, gardenAreaMapObjectId: String?, plantId: String?) async {
        isSubmittingCreate = true
        createErrorMessage = nil
        defer { isSubmittingCreate = false }

        do {
            _ = try await createManualTask(
                gardenId: gardenId,
                targetKind: createTargetKind,
                targetGardenAreaMapObjectId: gardenAreaMapObjectId,
                targetPlantId: plantId,
                title: title,
                notes: createNotes.isEmpty ? nil : createNotes,
                dueDate: createHasDueDate ? CalendarDate.string(from: createDueDate) : nil,
                timeWindowStart: createHasTimeWindow ? createTimeWindowStart : nil,
                timeWindowEnd: createHasTimeWindow ? createTimeWindowEnd : nil,
                urgency: createUrgency
            )
            resetCreateForm()
            await load()
        } catch let error as APIGatewayError {
            createErrorMessage = message(for: error)
        } catch {
            createErrorMessage = strings(.serverUnexpected)
        }
    }

    private func resetCreateForm() {
        createTitle = ""
        createNotes = ""
        createTargetKind = .garden
        createTargetGardenAreaMapObjectId = ""
        createTargetPlantId = ""
        createHasDueDate = false
        createDueDate = .now
        createHasTimeWindow = false
        createTimeWindowStart = .now
        createTimeWindowEnd = .now
        createUrgency = .normal
    }

    private func row(_ task: GardenTask) -> TaskRow {
        TaskRow(
            id: task.id,
            title: task.title,
            notes: task.notes,
            status: task.status,
            statusLabel: TasksLocalization.statusName(task.status, strings: strings),
            urgencyLabel: TasksLocalization.urgencyName(task.urgency, strings: strings),
            dueDateText: task.dueDate,
            targetLabel: targetLabel(for: task),
            revision: task.revision,
            isMutable: task.status.isMutable
        )
    }

    private func targetLabel(for task: GardenTask) -> String {
        switch task.targetKind {
        case .garden:
            return targetKindName(.garden)
        case .gardenArea:
            let id = task.targetGardenAreaMapObjectId ?? ""
            return "\(targetKindName(.gardenArea)): \(id)"
        case .plant:
            let id = task.targetPlantId ?? ""
            return "\(targetKindName(.plant)): \(id)"
        }
    }

    func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }

    private func message(for failure: CreateTaskFormValidation.Failure) -> String {
        switch failure {
        case .titleRequired: strings(.tasksTitleRequired)
        case .targetIdRequired: strings(.tasksTargetIdRequired)
        }
    }
}
