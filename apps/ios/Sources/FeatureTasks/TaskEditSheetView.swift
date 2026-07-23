import CoreDomain
import Foundation
import SwiftUI

/// The "Edit" sheet, only ever reachable for a `planned`/`suggested` task —
/// `TasksListView` hides the action entirely for a terminal-status task
/// rather than showing it disabled.
///
/// Always submits every field it shows as an explicit value (`FieldUpdate
/// .set`), never `.unchanged`: the form is pre-populated from the task's
/// current state, so resubmitting an untouched field has the same effect as
/// truly leaving it unchanged, without this sheet having to track which
/// fields the user actually touched — the same simplification
/// `PlantDetailViewModel.saveDetails` makes. `recurrenceRule` is
/// deliberately not offered here: the contract stores it "only... never
/// parsed, expanded, or validated this pass," so this sheet always resends
/// `.unchanged` for it rather than building a control for a value nothing
/// downstream does anything with yet.
struct TaskEditSheetView: View {
    let task: GardenTask
    let titleLabel: String
    let notesLabel: String
    let dueDateToggleLabel: String
    let dueDateLabel: String
    let timeWindowToggleLabel: String
    let timeWindowStartLabel: String
    let timeWindowEndLabel: String
    let urgencyLabel: String
    let submitTitle: String
    let closeTitle: String
    let isSubmitting: Bool
    let errorMessage: String?
    let urgencyName: (TaskUrgency) -> String
    let onSubmit: (String, String, Bool, Date, Bool, Date, Date, TaskUrgency) async -> Void
    let onClose: () -> Void

    @State private var title: String
    @State private var notes: String
    @State private var hasDueDate: Bool
    @State private var dueDate: Date
    @State private var hasTimeWindow: Bool
    @State private var timeWindowStart: Date
    @State private var timeWindowEnd: Date
    @State private var urgency: TaskUrgency

    init(
        task: GardenTask,
        titleLabel: String,
        notesLabel: String,
        dueDateToggleLabel: String,
        dueDateLabel: String,
        timeWindowToggleLabel: String,
        timeWindowStartLabel: String,
        timeWindowEndLabel: String,
        urgencyLabel: String,
        submitTitle: String,
        closeTitle: String,
        isSubmitting: Bool,
        errorMessage: String?,
        urgencyName: @escaping (TaskUrgency) -> String,
        onSubmit: @escaping (String, String, Bool, Date, Bool, Date, Date, TaskUrgency) async -> Void,
        onClose: @escaping () -> Void
    ) {
        self.task = task
        self.titleLabel = titleLabel
        self.notesLabel = notesLabel
        self.dueDateToggleLabel = dueDateToggleLabel
        self.dueDateLabel = dueDateLabel
        self.timeWindowToggleLabel = timeWindowToggleLabel
        self.timeWindowStartLabel = timeWindowStartLabel
        self.timeWindowEndLabel = timeWindowEndLabel
        self.urgencyLabel = urgencyLabel
        self.submitTitle = submitTitle
        self.closeTitle = closeTitle
        self.isSubmitting = isSubmitting
        self.errorMessage = errorMessage
        self.urgencyName = urgencyName
        self.onSubmit = onSubmit
        self.onClose = onClose
        _title = State(initialValue: task.title)
        _notes = State(initialValue: task.notes ?? "")
        _hasDueDate = State(initialValue: task.dueDate != nil)
        _dueDate = State(initialValue: task.dueDate.flatMap(CalendarDate.date(from:)) ?? .now)
        _hasTimeWindow = State(initialValue: task.timeWindowStart != nil || task.timeWindowEnd != nil)
        _timeWindowStart = State(initialValue: task.timeWindowStart ?? .now)
        _timeWindowEnd = State(initialValue: task.timeWindowEnd ?? .now)
        _urgency = State(initialValue: task.urgency)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField(titleLabel, text: $title)
                    .accessibilityIdentifier("tasks.edit.titleField")
                TextField(notesLabel, text: $notes, axis: .vertical)
                    .accessibilityIdentifier("tasks.edit.notesField")

                Toggle(dueDateToggleLabel, isOn: $hasDueDate)
                    .accessibilityIdentifier("tasks.edit.dueDateToggle")
                if hasDueDate {
                    DatePicker(dueDateLabel, selection: $dueDate, displayedComponents: .date)
                        .accessibilityIdentifier("tasks.edit.dueDatePicker")
                }

                Toggle(timeWindowToggleLabel, isOn: $hasTimeWindow)
                    .accessibilityIdentifier("tasks.edit.timeWindowToggle")
                if hasTimeWindow {
                    DatePicker(timeWindowStartLabel, selection: $timeWindowStart)
                        .accessibilityIdentifier("tasks.edit.timeWindowStartPicker")
                    DatePicker(timeWindowEndLabel, selection: $timeWindowEnd)
                        .accessibilityIdentifier("tasks.edit.timeWindowEndPicker")
                }

                Picker(urgencyLabel, selection: $urgency) {
                    ForEach(TaskUrgency.allCases, id: \.self) { value in
                        Text(urgencyName(value)).tag(value)
                    }
                }
                .accessibilityIdentifier("tasks.edit.urgencyPicker")

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                        .accessibilityIdentifier("tasks.edit.failure")
                }

                Button(submitTitle) {
                    Task {
                        await onSubmit(title, notes, hasDueDate, dueDate, hasTimeWindow, timeWindowStart, timeWindowEnd, urgency)
                    }
                }
                .disabled(isSubmitting)
                .accessibilityIdentifier("tasks.edit.submit")
            }
            .navigationTitle(titleLabel)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("tasks.edit.close")
                }
            }
        }
    }
}
