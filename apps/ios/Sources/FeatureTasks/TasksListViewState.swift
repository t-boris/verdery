import CoreDomain

/// One row of the task list, already localized.
public struct TaskRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let notes: String?
    public let status: TaskStatus
    public let statusLabel: String
    public let urgencyLabel: String
    /// The stored urgency alongside its localized label, so the row can pick
    /// a symbol and a tone — which SF Symbol stands for "urgent" is a
    /// presentation decision and belongs in the view.
    public let urgency: TaskUrgency
    public let dueDateText: String?
    public let targetLabel: String
    public let revision: Int
    /// Whether `EditTask`/`RescheduleTask`, or a status transition
    /// (`complete`/`dismiss`/`skip`/`delete`), is legal right now — the
    /// contract's "only while `planned`/`suggested`" rule
    /// (`TaskStatus.isMutable`). The row's action controls are hidden, not
    /// merely disabled, when this is `false`.
    public let isMutable: Bool
    /// Whether this task has an offline mutation committed this session that
    /// this pass's `LocalOnlySyncEngine` cannot yet confirm pushed — see
    /// `TasksListViewModel.locallyMutatedTaskIds`'s own doc comment for why
    /// this is session-scoped, not derived from a persisted outbox query.
    /// Shown as a "Saved locally, waiting to sync" badge next to the row,
    /// the per-row counterpart to `FeatureObservations.ObservationRow
    /// .isPendingSync` — a per-row flag, not one per-screen `syncStatusLabel`
    /// the way `FeatureGardens`/`FeatureMap`/`FeaturePlants` use, since every
    /// row here, not one edited record, is independently either confirmed or
    /// pending.
    public let isPendingSync: Bool
    /// "Assigned: {who}" — `nil` when unassigned, and also suppressed
    /// (`nil`) exactly when ``completedByChipLabel`` already names the same
    /// profile: showing "Assigned: Editor" next to "Completed by: Editor"
    /// for the identical person is redundant, not two facts. See
    /// `TasksListViewModel.row(_:)`'s own doc comment for the full rule.
    public let assignedChipLabel: String?
    /// "Completed by: {who}" — shown only once this task's status is
    /// `completed` and it actually has a `completedByProfileId`.
    public let completedByChipLabel: String?
}

/// Immutable display state for the task list screen.
public enum TasksListViewState: Equatable, Sendable {
    case loading
    case loaded([TaskRow])
    case failed(message: String)
}

/// One already-localized row of a task's activity timeline.
public struct TaskActivityRow: Equatable, Sendable, Identifiable {
    public let id: Int
    public let symbol: String
    /// The full sentence naming who did what — e.g. "Assigned to Editor —
    /// by Owner".
    public let text: String
    /// Populated only for the `editTask`/`rescheduleTask` entries that
    /// actually changed the due date — see `TaskCollaborationLocalization
    /// .row(for:roster:strings:)`'s own doc comment for why this is never
    /// fabricated for an entry the contract's own `dueDate` field left `nil`.
    public let dueDateCaption: String?
    public let recordedAtText: String
}

/// Immutable display state for one task's activity sheet.
public enum TaskActivityViewState: Equatable, Sendable {
    case loading
    case loaded([TaskActivityRow])
    case failed(message: String)
}

/// One already-localized row of the assignment picker — an active member
/// holding `editGardenContent` (owner or editor; a viewer is never offered,
/// matching the contract's own eligibility rule), named by role since no
/// display name exists — see `TaskCollaborationLocalization`'s own doc
/// comment.
public struct TaskAssignCandidateRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let profileId: String
    public let roleLabel: String
}
