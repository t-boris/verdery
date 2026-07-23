import CoreDomain

/// One row of the task list, already localized.
public struct TaskRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let notes: String?
    public let status: TaskStatus
    public let statusLabel: String
    public let urgencyLabel: String
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
}

/// Immutable display state for the task list screen.
public enum TasksListViewState: Equatable, Sendable {
    case loading
    case loaded([TaskRow])
    case failed(message: String)
}
