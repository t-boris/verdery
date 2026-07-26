import CoreDesignSystem
import CoreDomain
import SwiftUI

/// A garden's manual task list.
///
/// What changed, and why each change removes a tap or a moment of confusion:
///
/// - **The create form left the screen.** It was a permanently expanded
///   `Section` of eleven fields sitting between the filter and the tasks, so
///   the list a person came to read started below the fold. It is now a sheet
///   behind a toolbar `+` (``TaskCreateSheetView``).
/// - **Row actions became swipes.** Completing a task took four taps —
///   "Actions", read a seven-button dialog, choose, dismiss. Complete and skip
///   are now a leading swipe, delete a trailing one, and the full set stays
///   available in a long-press context menu for anyone who prefers it. The
///   confirmation dialog survives only for delete, which is the one action
///   here that cannot be undone.
/// - **Rows became dense.** Status, urgency, due date, and target were four
///   grey sentences; they are four chips on one wrapping line, each led by its
///   own symbol.
/// - **Haptics on commit.** Completing, skipping, or deleting a task is a
///   durable change with no animation of its own to feel; the tap now lands.
///
/// A row's actions stay hidden entirely, not merely disabled, once its status
/// is terminal — the contract's own "only while `planned`/`suggested`" rule,
/// unchanged.
///
/// File attachment remains out of scope: `AttachTaskFile` needs a `mediaId`
/// and this screen has no upload flow to produce one.
/// `completionNote`/`reason` are likewise still never collected — the contract
/// documents both as accepted but unstored, so a field for them would imply a
/// note is kept when it is not.
public struct TasksListView: View {
    @State private var model: TasksListViewModel
    @State private var isCreatePresented = false
    @State private var pendingDeletionTaskId: String?
    /// The filter row's height.
    ///
    /// A horizontal `ScrollView` has no ideal height of its own — it reports
    /// zero and then takes whatever it is given, so above a `List` it either
    /// swallowed the screen or collapsed to nothing (both happened, in that
    /// order, on the simulator). One scaled height, matching the minimum touch
    /// target its chips need anyway, settles it.
    @ScaledSize(Metrics.minimumTouchTarget) private var filterRowHeight

    public init(model: TasksListViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .screenBackground()
            .task { await model.load() }
            .refreshable { await model.load() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isCreatePresented = true
                    } label: {
                        Label(model.newTaskTitle, systemImage: "plus")
                    }
                    .accessibilityIdentifier("tasks.create.open")
                }
            }
            .sheet(isPresented: $isCreatePresented) { createSheet }
            .sheet(isPresented: isEditSheetPresented) { editSheet }
            .sheet(isPresented: isRescheduleSheetPresented) { rescheduleSheet }
            .confirmationDialog(
                model.deleteActionTitle,
                isPresented: isDeleteConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button(model.deleteActionTitle, role: .destructive) {
                    guard let taskId = pendingDeletionTaskId else { return }
                    perform { await model.delete(taskId: taskId) }
                }
                Button(model.cancelTitle, role: .cancel) { pendingDeletionTaskId = nil }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("tasks.loading")

        case let .loaded(rows) where rows.isEmpty:
            VStack(spacing: Metrics.space4) {
                filterBar
                EmptyStateView(
                    symbol: "checklist.unchecked",
                    title: model.title,
                    message: model.emptyMessage,
                    actionTitle: model.newTaskTitle,
                    action: { isCreatePresented = true }
                )
                .accessibilityIdentifier("tasks.empty")
                Spacer()
            }
            .padding(Metrics.space4)

        case let .loaded(rows):
            // The filter sits above the `List` rather than in a `Section` of
            // it: as a section it inherited the list's own top inset, which a
            // screenshot showed as a band of empty canvas between the toolbar
            // and the first chip — and it pushed the large navigation title
            // out of the bar on the way.
            VStack(spacing: 0) {
                filterBar

                List {
                    ForEach(rows) { row in
                        rowView(row)
                            .listRowInsets(
                                EdgeInsets(
                                    top: Metrics.space1,
                                    leading: Metrics.space4,
                                    bottom: Metrics.space1,
                                    trailing: Metrics.space4
                                )
                            )
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                leadingSwipeActions(row)
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                trailingSwipeActions(row)
                            }
                            .contextMenu { contextMenu(row) }
                    }

                    if let message = model.rowActionErrorMessage {
                        InlineMessage(message)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .accessibilityIdentifier("tasks.rowAction.failure")
                    }
                }
                .listStyle(.plain)
            }

        case let .failed(message):
            FailureStateView(
                message: message,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("tasks.failure")
        }
    }

    /// The status filter as a horizontal row of chips rather than a `Picker`
    /// in a labelled form row: the current filter is visible without opening
    /// anything, and changing it is one tap instead of three.
    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Metrics.space2) {
                filterChip(status: nil, label: model.filterAllLabel, symbol: "line.3.horizontal.decrease")
                ForEach(TaskStatus.allCases, id: \.self) { status in
                    filterChip(
                        status: status,
                        label: model.statusName(status),
                        symbol: TaskSymbols.status(status)
                    )
                }
            }
            .padding(.horizontal, Metrics.space4)
            .padding(.vertical, Metrics.space2)
        }
        .frame(height: filterRowHeight + Metrics.space4)
        .accessibilityIdentifier("tasks.filter.statusPicker")
    }

    private func filterChip(status: TaskStatus?, label: String, symbol: String) -> some View {
        let isSelected = model.statusFilter == status

        return Button {
            model.statusFilter = status
            Haptics.play(.selection)
            Task { await model.load() }
        } label: {
            Chip(symbol: symbol, label: label, tone: isSelected ? .accent : .neutral)
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(
                            isSelected ? Palette.accent : Color.clear,
                            lineWidth: Metrics.hairline
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private func rowView(_ row: TaskRow) -> some View {
        SurfaceCard {
            HStack(alignment: .top, spacing: Metrics.space3) {
                IconMedallion(
                    symbol: TaskSymbols.status(row.status),
                    label: row.statusLabel,
                    tone: TaskSymbols.statusTone(row.status)
                )

                VStack(alignment: .leading, spacing: Metrics.space2) {
                    Text(row.title)
                        .font(Typography.heading)
                        .foregroundStyle(Palette.text)
                        .strikethrough(row.status == .completed)

                    if let notes = row.notes, !notes.isEmpty {
                        Text(notes)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                            .lineLimit(2)
                    }

                    HStack(spacing: Metrics.space2) {
                        Chip(
                            symbol: TaskSymbols.urgency(row.urgency),
                            label: row.urgencyLabel,
                            tone: TaskSymbols.urgencyTone(row.urgency)
                        )
                        if let dueDateText = row.dueDateText {
                            Chip(symbol: TaskSymbols.dueDate, label: dueDateText, tone: .info)
                        }
                        if row.isPendingSync {
                            StatusGlyph(
                                symbol: TaskSymbols.pendingSync,
                                label: model.savedLocallyLabel,
                                tone: .warning
                            )
                            .accessibilityIdentifier("tasks.row.\(row.id).savedLocally")
                        }
                        Spacer(minLength: 0)
                    }
                    .lineLimit(1)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("tasks.row.\(row.id)")
    }

    /// Complete and skip, the two things done to a task most often.
    ///
    /// `Button(role:)` plus `Label` rather than a bare icon: a swipe action's
    /// label IS its accessible name, and VoiceOver reads swipe actions aloud
    /// as custom actions, so an unlabelled glyph would be unreachable.
    @ViewBuilder
    private func leadingSwipeActions(_ row: TaskRow) -> some View {
        if row.isMutable {
            Button {
                perform { await model.complete(taskId: row.id) }
            } label: {
                Label(model.completeActionTitle, systemImage: TaskSymbols.complete)
            }
            .tint(Palette.positive)
            .accessibilityIdentifier("tasks.row.\(row.id).complete")

            Button {
                perform { await model.skip(taskId: row.id) }
            } label: {
                Label(model.skipActionTitle, systemImage: TaskSymbols.skip)
            }
            .tint(Palette.warning)
            .accessibilityIdentifier("tasks.row.\(row.id).skip")
        }
    }

    /// Delete is `allowsFullSwipe: false` and still confirms: it is the one
    /// action on this screen with no way back.
    @ViewBuilder
    private func trailingSwipeActions(_ row: TaskRow) -> some View {
        if row.isMutable {
            Button(role: .destructive) {
                pendingDeletionTaskId = row.id
            } label: {
                Label(model.deleteActionTitle, systemImage: TaskSymbols.delete)
            }
            .accessibilityIdentifier("tasks.row.\(row.id).delete")

            Button {
                model.editingTaskId = row.id
            } label: {
                Label(model.editActionTitle, systemImage: TaskSymbols.edit)
            }
            .tint(Palette.accent)
        }
    }

    /// The full set, for anyone who does not know the swipes are there.
    @ViewBuilder
    private func contextMenu(_ row: TaskRow) -> some View {
        if row.isMutable {
            Button {
                model.editingTaskId = row.id
            } label: {
                Label(model.editActionTitle, systemImage: TaskSymbols.edit)
            }
            Button {
                model.reschedulingTaskId = row.id
            } label: {
                Label(model.rescheduleActionTitle, systemImage: TaskSymbols.reschedule)
            }
            Button {
                perform { await model.complete(taskId: row.id) }
            } label: {
                Label(model.completeActionTitle, systemImage: TaskSymbols.complete)
            }
            Button {
                perform { await model.skip(taskId: row.id) }
            } label: {
                Label(model.skipActionTitle, systemImage: TaskSymbols.skip)
            }
            Button {
                perform { await model.dismiss(taskId: row.id) }
            } label: {
                Label(model.dismissActionTitle, systemImage: TaskSymbols.dismiss)
            }
            Button(role: .destructive) {
                pendingDeletionTaskId = row.id
            } label: {
                Label(model.deleteActionTitle, systemImage: TaskSymbols.delete)
            }
        }
    }

    /// Runs a row action and reports its outcome physically.
    private func perform(_ action: @escaping () async -> Void) {
        Task {
            await action()
            pendingDeletionTaskId = nil
            Haptics.play(model.rowActionErrorMessage == nil ? .success : .failure)
        }
    }

    private var isDeleteConfirmationPresented: Binding<Bool> {
        Binding(
            get: { pendingDeletionTaskId != nil },
            set: { isPresented in if !isPresented { pendingDeletionTaskId = nil } }
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

    private var createSheet: some View {
        TaskCreateSheetView(model: model) { didSucceed in
            Haptics.play(didSucceed ? .success : .failure)
            if didSucceed { isCreatePresented = false }
        }
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
