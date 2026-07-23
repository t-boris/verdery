import CoreDomain
import Foundation
import SwiftUI

/// The "Reschedule" sheet — `dueDate`/`timeWindow` only, sharing `Edit`'s
/// underlying update but kept as its own distinct command because
/// rescheduling is a distinct first-class user action (the contract's own
/// framing for `RescheduleTaskRequest`). Only ever reachable for a
/// `planned`/`suggested` task, the same guard `TaskEditSheetView` documents.
struct TaskRescheduleSheetView: View {
    let task: GardenTask
    let dueDateToggleLabel: String
    let dueDateLabel: String
    let timeWindowToggleLabel: String
    let timeWindowStartLabel: String
    let timeWindowEndLabel: String
    let submitTitle: String
    let closeTitle: String
    let title: String
    let isSubmitting: Bool
    let errorMessage: String?
    let onSubmit: (Bool, Date, Bool, Date, Date) async -> Void
    let onClose: () -> Void

    @State private var hasDueDate: Bool
    @State private var dueDate: Date
    @State private var hasTimeWindow: Bool
    @State private var timeWindowStart: Date
    @State private var timeWindowEnd: Date

    init(
        task: GardenTask,
        dueDateToggleLabel: String,
        dueDateLabel: String,
        timeWindowToggleLabel: String,
        timeWindowStartLabel: String,
        timeWindowEndLabel: String,
        submitTitle: String,
        closeTitle: String,
        title: String,
        isSubmitting: Bool,
        errorMessage: String?,
        onSubmit: @escaping (Bool, Date, Bool, Date, Date) async -> Void,
        onClose: @escaping () -> Void
    ) {
        self.task = task
        self.dueDateToggleLabel = dueDateToggleLabel
        self.dueDateLabel = dueDateLabel
        self.timeWindowToggleLabel = timeWindowToggleLabel
        self.timeWindowStartLabel = timeWindowStartLabel
        self.timeWindowEndLabel = timeWindowEndLabel
        self.submitTitle = submitTitle
        self.closeTitle = closeTitle
        self.title = title
        self.isSubmitting = isSubmitting
        self.errorMessage = errorMessage
        self.onSubmit = onSubmit
        self.onClose = onClose
        _hasDueDate = State(initialValue: task.dueDate != nil)
        _dueDate = State(initialValue: task.dueDate.flatMap(CalendarDate.date(from:)) ?? .now)
        _hasTimeWindow = State(initialValue: task.timeWindowStart != nil || task.timeWindowEnd != nil)
        _timeWindowStart = State(initialValue: task.timeWindowStart ?? .now)
        _timeWindowEnd = State(initialValue: task.timeWindowEnd ?? .now)
    }

    var body: some View {
        NavigationStack {
            Form {
                Toggle(dueDateToggleLabel, isOn: $hasDueDate)
                    .accessibilityIdentifier("tasks.reschedule.dueDateToggle")
                if hasDueDate {
                    DatePicker(dueDateLabel, selection: $dueDate, displayedComponents: .date)
                        .accessibilityIdentifier("tasks.reschedule.dueDatePicker")
                }

                Toggle(timeWindowToggleLabel, isOn: $hasTimeWindow)
                    .accessibilityIdentifier("tasks.reschedule.timeWindowToggle")
                if hasTimeWindow {
                    DatePicker(timeWindowStartLabel, selection: $timeWindowStart)
                        .accessibilityIdentifier("tasks.reschedule.timeWindowStartPicker")
                    DatePicker(timeWindowEndLabel, selection: $timeWindowEnd)
                        .accessibilityIdentifier("tasks.reschedule.timeWindowEndPicker")
                }

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                        .accessibilityIdentifier("tasks.reschedule.failure")
                }

                Button(submitTitle) {
                    Task { await onSubmit(hasDueDate, dueDate, hasTimeWindow, timeWindowStart, timeWindowEnd) }
                }
                .disabled(isSubmitting)
                .accessibilityIdentifier("tasks.reschedule.submit")
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("tasks.reschedule.close")
                }
            }
        }
    }
}
