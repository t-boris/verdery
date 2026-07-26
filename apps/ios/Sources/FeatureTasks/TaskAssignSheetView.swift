import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The "Assign" sheet — assign, reassign, or clear a task's assignment
/// (P9A-TASK-01).
///
/// A sheet reached from the list row's context menu, matching
/// `TaskEditSheetView`/`TaskRescheduleSheetView`'s own established pattern
/// exactly ("a sheet that edits one field and calls a command") rather than
/// a separate task-detail screen: this app has no such screen for any other
/// task field either, so assignment does not invent one.
///
/// The candidate list is loaded fresh every time this sheet opens
/// (`.task {}` below) — see `TasksListViewModel.loadAssignCandidates()`'s
/// own doc comment for why a `membersById` populated by an earlier `load()`
/// is not trusted here without a fresh fetch.
struct TaskAssignSheetView: View {
    let candidates: [TaskAssignCandidateRow]
    let currentAssigneeProfileId: String?
    let title: String
    let unassignedOptionLabel: String
    let submitTitle: String
    let closeTitle: String
    let isLoadingCandidates: Bool
    let candidatesLoadingMessage: String
    let candidatesEmptyMessage: String
    let candidatesErrorMessage: String?
    let isSubmitting: Bool
    let submitErrorMessage: String?
    let onAppear: () async -> Void
    let onSubmit: (String?) async -> Void
    let onClose: () -> Void

    @State private var selection: String?

    init(
        candidates: [TaskAssignCandidateRow],
        currentAssigneeProfileId: String?,
        title: String,
        unassignedOptionLabel: String,
        submitTitle: String,
        closeTitle: String,
        isLoadingCandidates: Bool,
        candidatesLoadingMessage: String,
        candidatesEmptyMessage: String,
        candidatesErrorMessage: String?,
        isSubmitting: Bool,
        submitErrorMessage: String?,
        onAppear: @escaping () async -> Void,
        onSubmit: @escaping (String?) async -> Void,
        onClose: @escaping () -> Void
    ) {
        self.candidates = candidates
        self.currentAssigneeProfileId = currentAssigneeProfileId
        self.title = title
        self.unassignedOptionLabel = unassignedOptionLabel
        self.submitTitle = submitTitle
        self.closeTitle = closeTitle
        self.isLoadingCandidates = isLoadingCandidates
        self.candidatesLoadingMessage = candidatesLoadingMessage
        self.candidatesEmptyMessage = candidatesEmptyMessage
        self.candidatesErrorMessage = candidatesErrorMessage
        self.isSubmitting = isSubmitting
        self.submitErrorMessage = submitErrorMessage
        self.onAppear = onAppear
        self.onSubmit = onSubmit
        self.onClose = onClose
        _selection = State(initialValue: currentAssigneeProfileId)
    }

    var body: some View {
        NavigationStack {
            Form {
                if isLoadingCandidates {
                    LoadingStateView(candidatesLoadingMessage)
                        .accessibilityIdentifier("tasks.assign.candidatesLoading")
                } else if let candidatesErrorMessage {
                    InlineMessage(candidatesErrorMessage)
                        .accessibilityIdentifier("tasks.assign.candidatesFailure")
                } else {
                    Picker(title, selection: $selection) {
                        Text(unassignedOptionLabel).tag(String?.none)
                        ForEach(candidates) { candidate in
                            Text(candidate.roleLabel).tag(String?.some(candidate.profileId))
                        }
                    }
                    .pickerStyle(.inline)
                    .accessibilityIdentifier("tasks.assign.picker")

                    if candidates.isEmpty {
                        Text(candidatesEmptyMessage)
                            .foregroundStyle(Palette.textMuted)
                            .accessibilityIdentifier("tasks.assign.candidatesEmpty")
                    }
                }

                if let submitErrorMessage {
                    InlineMessage(submitErrorMessage)
                        .accessibilityIdentifier("tasks.assign.failure")
                }

                Button(submitTitle) {
                    Task { await onSubmit(selection) }
                }
                .disabled(isSubmitting || isLoadingCandidates)
                .accessibilityIdentifier("tasks.assign.submit")
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("tasks.assign.close")
                }
            }
            .task { await onAppear() }
        }
    }
}
