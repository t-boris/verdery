import CoreDesignSystem
import CoreDomain
import Foundation
import SwiftUI

/// The "Reschedule" sheet.
///
/// Was a `Form` of two `Toggle`s and three `DatePicker`s. Neither toggle was a
/// boolean — each was the presence of an optional value, split across two
/// controls that had to agree — and neither date wanted a wheel: rescheduling
/// is almost always to today, tomorrow, the weekend, or next week.
///
/// `dueDate`/`timeWindow` only, sharing `Edit`'s
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
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    OptionalValueCard(
                        fieldName: dueDateLabel,
                        addPrompt: dueDateToggleLabel,
                        clearLabel: closeTitle,
                        symbol: "calendar",
                        displayValue: hasDueDate ? TaskDateText.day(dueDate) : nil,
                        clear: { hasDueDate = false }
                    ) {
                        DateDial(
                            fieldName: dueDateLabel,
                            selection: $dueDate,
                            now: .now,
                            calendar: .current,
                            chipTitle: TaskDateText.relativeTitle,
                            dayNumber: TaskDateText.dayNumber,
                            weekdayName: TaskDateText.weekday,
                            longDate: TaskDateText.day
                        )
                        .onAppear { hasDueDate = true }
                    }
                    .accessibilityIdentifier("tasks.reschedule.dueDate")

                    OptionalValueCard(
                        fieldName: timeWindowStartLabel,
                        addPrompt: timeWindowToggleLabel,
                        clearLabel: closeTitle,
                        symbol: "clock",
                        displayValue: hasTimeWindow
                            ? TaskDateText.window(timeWindowStart, timeWindowEnd) : nil,
                        clear: { hasTimeWindow = false }
                    ) {
                        TimeWindowBar(
                            fieldName: timeWindowStartLabel,
                            start: $timeWindowStart,
                            end: $timeWindowEnd,
                            calendar: .current,
                            timeText: TaskDateText.time
                        )
                        .onAppear { hasTimeWindow = true }
                    }
                    .accessibilityIdentifier("tasks.reschedule.timeWindow")

                    if let errorMessage {
                        InlineMessage(errorMessage, tone: .negative)
                            .accessibilityIdentifier("tasks.reschedule.failure")
                    }

                    Button(submitTitle) {
                        Task {
                            await onSubmit(
                                hasDueDate, dueDate, hasTimeWindow, timeWindowStart, timeWindowEnd
                            )
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("tasks.reschedule.submit")
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("tasks.reschedule.close")
                }
            }
        }
    }
}
