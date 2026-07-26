import CoreDomain
import CoreLocalization
import Foundation

/// Display logic for task assignment and activity-history rows — kept
/// separate from the view model the same way `TasksLocalization`/
/// `ObservationsLocalization` are kept separate from their own view models.
///
/// No entry here ever shows a real person's name: `GET /gardens/{gardenId}
/// /members` (`CollaborationGateway.listMembers`) carries only `profileId`
/// and `role` — see `CoreNetworking.CollaborationGateway`'s own doc comment
/// for why no name exists anywhere server-side to show. "Who" is therefore
/// always the member's role (`Owner`/`Editor`/`Viewer`) when the roster has
/// an entry for that profile id, falling back to the RAW profile id when it
/// does not — the same "the honest fallback" convention
/// `TasksListViewModel.targetLabel`/`TodayViewModel.targetLabel` already
/// establish for an id this client cannot resolve to anything friendlier,
/// never a fabricated placeholder. This client also has no reliable way to
/// know its OWN application profile id (`CorePersistence.LocalDatabase`'s own
/// doc comment: "the application profile ID... this client never fetches
/// directly") — so this deliberately never attempts an "assigned to you" /
/// "you completed this" comparison either; every identity, including the
/// signed-in reader's own, renders through the identical role-or-id rule.
public enum TaskCollaborationLocalization {
    public static func roleName(_ role: GardenRole, strings: LocalizedStrings) -> String {
        switch role {
        case .owner: strings(.gardensRoleOwner)
        case .editor: strings(.gardensRoleEditor)
        case .viewer: strings(.gardensRoleViewer)
        }
    }

    /// The role name for `profileId` when `roster` has an active entry for
    /// it, else the raw id — see this type's own doc comment for why a raw
    /// id, not a placeholder, is the correct fallback (it covers, honestly,
    /// both "never fetched the roster" and "this actor is no longer an
    /// active member," the exact case `GardenTask.completedByProfileId`'s
    /// own doc comment says stays readable after the actor loses access).
    public static func identity(for profileId: String, roster: [String: GardenRole], strings: LocalizedStrings) -> String {
        guard let role = roster[profileId] else { return profileId }
        return roleName(role, strings: strings)
    }

    /// "Assigned: {who}" for a task's row/detail — `nil` when unassigned, or
    /// when it would be redundant with ``completedByChipLabel(for:roster:strings:)``
    /// naming the identical profile. See ``TasksListViewState.TaskRow``'s own
    /// doc comment for the full "differs meaningfully" reasoning this
    /// implements.
    public static func assignedChipLabel(
        for task: GardenTask,
        roster: [String: GardenRole],
        strings: LocalizedStrings
    ) -> String? {
        guard let assignedProfileId = task.assignedProfileId else { return nil }
        if task.status == .completed, task.completedByProfileId == assignedProfileId {
            return nil
        }
        return strings.string(.tasksAssignedToLabel, parameters: ["who": identity(for: assignedProfileId, roster: roster, strings: strings)])
    }

    /// "Completed by: {who}" — shown whenever a completed task actually has
    /// a `completedByProfileId`, regardless of whether it matches
    /// `assignedProfileId`: this is the one slot that always tells "who
    /// finished it," and ``assignedChipLabel(for:roster:strings:)`` is what
    /// steps aside to avoid repeating the same name next to it.
    public static func completedByChipLabel(
        for task: GardenTask,
        roster: [String: GardenRole],
        strings: LocalizedStrings
    ) -> String? {
        guard task.status == .completed, let completedByProfileId = task.completedByProfileId else { return nil }
        return strings.string(.tasksCompletedByLabel, parameters: ["who": identity(for: completedByProfileId, roster: roster, strings: strings)])
    }

    /// Which SF Symbol stands for one activity entry's own command — a
    /// presentation decision, kept here rather than on `CoreDomain
    /// .TaskActivityCommandType` the same way `TaskSymbols` keeps every other
    /// symbol choice out of `CoreDomain`.
    public static func symbol(for commandType: TaskActivityCommandType) -> String {
        switch commandType {
        case .createManualTask: "plus.circle"
        case .editTask: TaskSymbols.edit
        case .rescheduleTask: TaskSymbols.reschedule
        case .completeTask: TaskSymbols.complete
        case .dismissTask: TaskSymbols.dismiss
        case .skipTask: TaskSymbols.skip
        case .deleteTask: TaskSymbols.delete
        case .convertRecommendationToTask: "sparkles"
        case .assignTask: "person.crop.circle.badge.checkmark"
        }
    }

    /// The full sentence for one activity entry, naming who acted and — for
    /// `assignTask` — who was assigned or that the task was unassigned.
    private static func text(for entry: TaskActivityEntry, roster: [String: GardenRole], strings: LocalizedStrings) -> String {
        let actor = identity(for: entry.actorProfileId, roster: roster, strings: strings)

        switch entry.commandType {
        case .createManualTask: return strings.string(.tasksActivityCreated, parameters: ["actor": actor])
        case .editTask: return strings.string(.tasksActivityEdited, parameters: ["actor": actor])
        case .rescheduleTask: return strings.string(.tasksActivityRescheduled, parameters: ["actor": actor])
        case .completeTask: return strings.string(.tasksActivityCompleted, parameters: ["actor": actor])
        case .dismissTask: return strings.string(.tasksActivityDismissed, parameters: ["actor": actor])
        case .skipTask: return strings.string(.tasksActivitySkipped, parameters: ["actor": actor])
        case .deleteTask: return strings.string(.tasksActivityDeleted, parameters: ["actor": actor])
        case .convertRecommendationToTask: return strings.string(.tasksActivityConverted, parameters: ["actor": actor])
        case .assignTask:
            guard let assignedProfileId = entry.assignedProfileId else {
                return strings.string(.tasksActivityUnassigned, parameters: ["actor": actor])
            }
            let assignee = identity(for: assignedProfileId, roster: roster, strings: strings)
            return strings.string(.tasksActivityAssigned, parameters: ["assignee": assignee, "actor": actor])
        }
    }

    /// Builds one already-localized ``TaskActivityRow`` — the activity
    /// sheet's own "simple, honest timeline" rendering, never showing more
    /// than the contract's `TaskActivityEntry` actually returns:
    /// `dueDateCaption` is populated only when `entry.dueDate` itself is
    /// non-`nil` (the contract's own "populated only for the entries that
    /// changed the due date"), and `entry.status` is never echoed separately
    /// — every command's own verb (``text(for:roster:strings:)``) already
    /// says what changed, so repeating the raw status would be redundant,
    /// not additional information.
    public static func row(for entry: TaskActivityEntry, roster: [String: GardenRole], strings: LocalizedStrings) -> TaskActivityRow {
        TaskActivityRow(
            id: entry.id,
            symbol: symbol(for: entry.commandType),
            text: text(for: entry, roster: roster, strings: strings),
            dueDateCaption: entry.dueDate.map { strings.string(.tasksActivityDueDateCaption, parameters: ["date": $0]) },
            recordedAtText: formattedRecordedAt(entry.recordedAt)
        )
    }

    /// Not a stored `static let`: `DateFormatter` is not `Sendable` — the
    /// same reason `ObservationsLocalization.formattedObservedAt` computes
    /// its formatter fresh.
    public static func formattedRecordedAt(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = .autoupdatingCurrent
        return formatter.string(from: date)
    }
}
