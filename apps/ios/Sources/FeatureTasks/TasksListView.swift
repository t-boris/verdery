import CoreDomain
import SwiftUI

/// A garden's manual task list: create, filter by status, and per-task
/// actions (edit, reschedule, complete, dismiss, skip, delete).
///
/// A row's actions are hidden entirely, not merely disabled, once its status
/// is terminal (`completed`/`skipped`/`dismissed`/`deleted`) — the contract's
/// own "only while `planned`/`suggested`" rule.
///
/// File attachment is out of scope this pass: `AttachTaskFile` needs a
/// `mediaId`, and this codebase has no file-upload flow yet to produce one
/// (`media.media_record` only records that a reference exists) — the same
/// gap `FeaturePlants` and `FeatureObservations` document for their own
/// media-dependent operations. `completionNote`/`reason` (on complete/
/// dismiss) are likewise never collected here: the contract itself
/// documents both as "accepted for interface completeness but has no
/// storage target this pass," so a text-entry sheet for a value the server
/// discards would add UI complexity with no user-visible effect, and could
/// read as though the note were actually saved.
public struct TasksListView: View {
    @State private var model: TasksListViewModel

    public init(model: TasksListViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        List {
            filterSection
            createSection
            taskSection
        }
        .navigationTitle(model.title)
        .task { await model.load() }
        .refreshable { await model.load() }
        .sheet(isPresented: isEditSheetPresented) { editSheet }
        .sheet(isPresented: isRescheduleSheetPresented) { rescheduleSheet }
    }

    private var filterSection: some View {
        Section(model.filterLabel) {
            Picker(model.filterLabel, selection: statusFilterBinding) {
                Text(model.filterAllLabel).tag(TaskStatus?.none)
                ForEach(TaskStatus.allCases, id: \.self) { status in
                    Text(model.statusName(status)).tag(TaskStatus?.some(status))
                }
            }
            .labelsHidden()
            .accessibilityIdentifier("tasks.filter.statusPicker")
        }
    }

    private var statusFilterBinding: Binding<TaskStatus?> {
        Binding(
            get: { model.statusFilter },
            set: { newValue in
                model.statusFilter = newValue
                Task { await model.load() }
            }
        )
    }

    private var createSection: some View {
        Section(model.createSectionTitle) {
            TextField(model.titleLabel, text: $model.createTitle)
                .accessibilityIdentifier("tasks.create.titleField")
            TextField(model.notesLabel, text: $model.createNotes, axis: .vertical)
                .accessibilityIdentifier("tasks.create.notesField")

            Picker(model.targetKindLabel, selection: $model.createTargetKind) {
                ForEach(TaskTargetKind.allCases, id: \.self) { kind in
                    Text(model.targetKindName(kind)).tag(kind)
                }
            }
            .accessibilityIdentifier("tasks.create.targetKindPicker")

            if model.createTargetKind == .gardenArea {
                TextField(model.targetGardenAreaLabel, text: $model.createTargetGardenAreaMapObjectId)
                    .accessibilityIdentifier("tasks.create.targetGardenAreaField")
            }
            if model.createTargetKind == .plant {
                TextField(model.targetPlantLabel, text: $model.createTargetPlantId)
                    .accessibilityIdentifier("tasks.create.targetPlantField")
            }
            if model.createTargetKind != .garden {
                Text(model.mapObjectIdHint)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Toggle(model.dueDateToggleLabel, isOn: $model.createHasDueDate)
                .accessibilityIdentifier("tasks.create.dueDateToggle")
            if model.createHasDueDate {
                DatePicker(model.dueDateLabel, selection: $model.createDueDate, displayedComponents: .date)
                    .accessibilityIdentifier("tasks.create.dueDatePicker")
            }

            Toggle(model.timeWindowToggleLabel, isOn: $model.createHasTimeWindow)
                .accessibilityIdentifier("tasks.create.timeWindowToggle")
            if model.createHasTimeWindow {
                DatePicker(model.timeWindowStartLabel, selection: $model.createTimeWindowStart)
                    .accessibilityIdentifier("tasks.create.timeWindowStartPicker")
                DatePicker(model.timeWindowEndLabel, selection: $model.createTimeWindowEnd)
                    .accessibilityIdentifier("tasks.create.timeWindowEndPicker")
            }

            Picker(model.urgencyLabel, selection: $model.createUrgency) {
                ForEach(TaskUrgency.allCases, id: \.self) { urgency in
                    Text(model.urgencyName(urgency)).tag(urgency)
                }
            }
            .accessibilityIdentifier("tasks.create.urgencyPicker")

            if let message = model.createErrorMessage {
                Text(message).foregroundStyle(.red)
                    .accessibilityIdentifier("tasks.create.failure")
            }

            Button(model.createSubmitTitle) {
                Task { await model.submitCreateTask() }
            }
            .disabled(model.isSubmittingCreate)
            .accessibilityIdentifier("tasks.create.submit")
        }
    }

    @ViewBuilder
    private var taskSection: some View {
        switch model.state {
        case .loading:
            Section {
                ProgressView(model.loadingMessage)
                    .accessibilityIdentifier("tasks.loading")
            }

        case let .loaded(rows) where rows.isEmpty:
            Section {
                Text(model.emptyMessage)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("tasks.empty")
            }

        case let .loaded(rows):
            Section {
                ForEach(rows) { row in
                    rowView(row)
                }

                if let message = model.rowActionErrorMessage {
                    Text(message).foregroundStyle(.red)
                        .accessibilityIdentifier("tasks.rowAction.failure")
                }
            }

        case let .failed(message):
            Section {
                Text(message).accessibilityIdentifier("tasks.failure")
                Button(model.retryTitle) { Task { await model.load() } }
            }
        }
    }

    private func rowView(_ row: TaskRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(row.title).font(.headline)
            if let notes = row.notes, !notes.isEmpty {
                Text(notes).font(.footnote).foregroundStyle(.secondary)
            }
            HStack {
                Text(row.statusLabel)
                Text("·")
                Text(row.urgencyLabel)
                if let dueDateText = row.dueDateText {
                    Text("·")
                    Text(dueDateText)
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            Text(row.targetLabel).font(.caption).foregroundStyle(.secondary)

            if row.isMutable {
                Button(model.actionsTitle) {
                    model.activeActionsTaskId = row.id
                }
                .font(.footnote)
                .accessibilityIdentifier("tasks.row.\(row.id).actions")
                .confirmationDialog(
                    model.actionsTitle,
                    isPresented: actionsPresentedBinding(for: row.id),
                    titleVisibility: .visible
                ) {
                    actionsDialogButtons(for: row.id)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("tasks.row.\(row.id)")
    }

    @ViewBuilder
    private func actionsDialogButtons(for taskId: String) -> some View {
        Button(model.editActionTitle) { model.editingTaskId = taskId }
        Button(model.rescheduleActionTitle) { model.reschedulingTaskId = taskId }
        Button(model.completeActionTitle) { Task { await model.complete(taskId: taskId) } }
        Button(model.skipActionTitle) { Task { await model.skip(taskId: taskId) } }
        Button(model.dismissActionTitle) { Task { await model.dismiss(taskId: taskId) } }
        Button(model.deleteActionTitle, role: .destructive) { Task { await model.delete(taskId: taskId) } }
        Button(model.cancelTitle, role: .cancel) {}
    }

    private func actionsPresentedBinding(for taskId: String) -> Binding<Bool> {
        Binding(
            get: { model.activeActionsTaskId == taskId },
            set: { isPresented in if !isPresented { model.activeActionsTaskId = nil } }
        )
    }

    private var isEditSheetPresented: Binding<Bool> {
        Binding(
            get: { model.editingTaskId != nil },
            set: { isPresented in if !isPresented { model.editingTaskId = nil } }
        )
    }

    private var isRescheduleSheetPresented: Binding<Bool> {
        Binding(
            get: { model.reschedulingTaskId != nil },
            set: { isPresented in if !isPresented { model.reschedulingTaskId = nil } }
        )
    }

    @ViewBuilder
    private var editSheet: some View {
        if let taskId = model.editingTaskId, let task = model.tasksById[taskId] {
            TaskEditSheetView(
                task: task,
                titleLabel: model.titleLabel,
                notesLabel: model.notesLabel,
                dueDateToggleLabel: model.dueDateToggleLabel,
                dueDateLabel: model.dueDateLabel,
                timeWindowToggleLabel: model.timeWindowToggleLabel,
                timeWindowStartLabel: model.timeWindowStartLabel,
                timeWindowEndLabel: model.timeWindowEndLabel,
                urgencyLabel: model.urgencyLabel,
                submitTitle: model.editActionTitle,
                closeTitle: model.closeTitle,
                isSubmitting: model.isPerformingRowAction,
                errorMessage: model.rowActionErrorMessage,
                urgencyName: { model.urgencyName($0) },
                onSubmit: { title, notes, hasDueDate, dueDate, hasTimeWindow, start, end, urgency in
                    await model.submitEdit(
                        taskId: taskId,
                        title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                        notes: .set(notes.isEmpty ? nil : notes),
                        dueDate: .set(hasDueDate ? CalendarDate.string(from: dueDate) : nil),
                        timeWindowStart: .set(hasTimeWindow ? start : nil),
                        timeWindowEnd: .set(hasTimeWindow ? end : nil),
                        urgency: urgency
                    )
                },
                onClose: { model.editingTaskId = nil }
            )
        }
    }

    @ViewBuilder
    private var rescheduleSheet: some View {
        if let taskId = model.reschedulingTaskId, let task = model.tasksById[taskId] {
            TaskRescheduleSheetView(
                task: task,
                dueDateToggleLabel: model.dueDateToggleLabel,
                dueDateLabel: model.dueDateLabel,
                timeWindowToggleLabel: model.timeWindowToggleLabel,
                timeWindowStartLabel: model.timeWindowStartLabel,
                timeWindowEndLabel: model.timeWindowEndLabel,
                submitTitle: model.rescheduleActionTitle,
                closeTitle: model.closeTitle,
                title: model.rescheduleActionTitle,
                isSubmitting: model.isPerformingRowAction,
                errorMessage: model.rowActionErrorMessage,
                onSubmit: { hasDueDate, dueDate, hasTimeWindow, start, end in
                    await model.submitReschedule(
                        taskId: taskId,
                        dueDate: .set(hasDueDate ? CalendarDate.string(from: dueDate) : nil),
                        timeWindowStart: .set(hasTimeWindow ? start : nil),
                        timeWindowEnd: .set(hasTimeWindow ? end : nil)
                    )
                },
                onClose: { model.reschedulingTaskId = nil }
            )
        }
    }
}
