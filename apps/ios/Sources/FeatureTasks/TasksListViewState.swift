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
}

/// Immutable display state for the task list screen.
public enum TasksListViewState: Equatable, Sendable {
    case loading
    case loaded([TaskRow])
    case failed(message: String)
}
