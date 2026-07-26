import Foundation

/// The command that produced one `TaskActivityEntry` row.
///
/// Mirrors `packages/api-contracts/openapi.yaml`'s `TaskActivityEntry
/// .commandType` enum exactly — every command that appends to the
/// `tasks_recommendations.task_revision` journal, including
/// `convertRecommendationToTask` (P7-BE-01), which this client's own task
/// use cases never call directly but which can still appear in a task's
/// history if its origin was a converted recommendation.
public enum TaskActivityCommandType: String, Codable, Equatable, Sendable, CaseIterable {
    case createManualTask
    case editTask
    case rescheduleTask
    case completeTask
    case dismissTask
    case skipTask
    case deleteTask
    case convertRecommendationToTask
    case assignTask
}

/// One row of a task's shared activity history (P9A-TASK-01, row B17) — the
/// application-layer projection of one `tasks_recommendations.task_revision`
/// row: every accepted command against this task, oldest first, naming who
/// performed it and what it changed.
///
/// `id` is `revision`, not a separately minted identifier: a task's revision
/// is unique and stable for that task's own journal, and the contract mints
/// no other id for this row — the same "the field the contract actually
/// gives is the honest id" reasoning as leaning on `revision` for optimistic
/// concurrency elsewhere in this codebase.
///
/// Source: packages/api-contracts/openapi.yaml, `TaskActivityEntry`.
public struct TaskActivityEntry: Equatable, Sendable, Identifiable {
    public var id: Int { revision }

    public let revision: Int
    public let commandType: TaskActivityCommandType
    public let actorProfileId: String
    /// Populated only for the entries that changed status.
    public let status: TaskStatus?
    /// Populated only for the entries that changed the due date.
    public let dueDate: String?
    /// Populated only for `assignTask` entries — the assignee that command
    /// settled on, or `nil` for an unassignment.
    public let assignedProfileId: String?
    public let recordedAt: Date

    public init(
        revision: Int,
        commandType: TaskActivityCommandType,
        actorProfileId: String,
        status: TaskStatus?,
        dueDate: String?,
        assignedProfileId: String?,
        recordedAt: Date
    ) {
        self.revision = revision
        self.commandType = commandType
        self.actorProfileId = actorProfileId
        self.status = status
        self.dueDate = dueDate
        self.assignedProfileId = assignedProfileId
        self.recordedAt = recordedAt
    }
}
