/// Keys the task-assignment and activity-history screens resolve against the
/// localization catalogue (P9A-TASK-01, P9A-IOS-01).
///
/// A second enum for the same structural reason ``ProfileLocalizationKey``
/// is one, not a stylistic choice: ``LocalizationKey`` already sits at the
/// 600-line ceiling `scripts/check-file-size.mjs` enforces, so a new key can
/// only be added in a new file, and an enum's cases cannot be declared in an
/// extension. See ``ProfileLocalizationKey``'s own doc comment for the full
/// reasoning — it applies unchanged here.
public enum TaskCollaborationLocalizationKey: String, Sendable, CaseIterable {
    case tasksAssignAction = "tasks.assignAction"
    case tasksAssignTitle = "tasks.assign.title"
    case tasksAssignUnassignedOption = "tasks.assign.unassignedOption"
    case tasksAssignSubmit = "tasks.assign.submit"
    case tasksAssignCandidatesLoading = "tasks.assign.candidatesLoading"
    case tasksAssignCandidatesEmpty = "tasks.assign.candidatesEmpty"
    case tasksAssignCandidatesFailed = "tasks.assign.candidatesFailed"
    case tasksAssignConflict = "tasks.assign.conflict"
    case tasksAssignedToLabel = "tasks.assignedToLabel"
    case tasksCompletedByLabel = "tasks.completedByLabel"

    case tasksActivityAction = "tasks.activityAction"
    case tasksActivityTitle = "tasks.activity.title"
    case tasksActivityLoading = "tasks.activity.loading"
    case tasksActivityEmpty = "tasks.activity.empty"
    case tasksActivityFailed = "tasks.activity.failed"
    case tasksActivityCreated = "tasks.activity.created"
    case tasksActivityEdited = "tasks.activity.edited"
    case tasksActivityRescheduled = "tasks.activity.rescheduled"
    case tasksActivityCompleted = "tasks.activity.completed"
    case tasksActivityDismissed = "tasks.activity.dismissed"
    case tasksActivitySkipped = "tasks.activity.skipped"
    case tasksActivityDeleted = "tasks.activity.deleted"
    case tasksActivityConverted = "tasks.activity.converted"
    case tasksActivityAssigned = "tasks.activity.assigned"
    case tasksActivityUnassigned = "tasks.activity.unassigned"
    case tasksActivityDueDateCaption = "tasks.activity.dueDateCaption"
}
