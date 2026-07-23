import CoreDomain
import Foundation

/// `status` transitions — a client-side mirror of the server's own
/// `task-lifecycle.ts`, split out of `TaskDetailProjection.swift`/
/// `TasksUseCases.swift` for the same reason that file gives: `requireEditableStatus`
/// is the one precondition every mutating command beyond `CreateManualTask`
/// shares, so it is factored once here rather than duplicated across
/// `EditTask`/`RescheduleTask` (via `TaskDetailProjection`) and
/// `CompleteTask`/`DismissTask`/`SkipTask`/`DeleteTask` (via
/// `TaskTerminalStatus.apply` below).
///
/// Source: services/api/.../tasks-recommendations/domain/task-lifecycle.ts.
enum TaskLifecycleRules {
    /// Throws when `task.status` is not `planned`/`suggested`
    /// (`TaskStatus.isMutable`) — the shared precondition this file's own doc
    /// comment describes.
    static func requireEditableStatus(_ task: GardenTask) throws {
        guard task.status.isMutable else {
            throw TaskCommandError.taskNotEditable
        }
    }
}

/// The four statuses `CompleteTask`/`DismissTask`/`SkipTask`/`DeleteTask`
/// each transition into — every one of them terminal, mirroring the server's
/// own `TaskTerminalStatus` (`task-lifecycle.ts`).
enum TaskTerminalStatus: Equatable, Sendable {
    case completed
    case dismissed
    case skipped
    case deleted

    var status: TaskStatus {
        switch self {
        case .completed: .completed
        case .dismissed: .dismissed
        case .skipped: .skipped
        case .deleted: .deleted
        }
    }

    /// Shared local projection for `CompleteTask`, `DismissTask`, `SkipTask`,
    /// and `DeleteTask`: all four apply the identical precondition
    /// (`TaskLifecycleRules.requireEditableStatus`) and the identical shape
    /// of change (set `status`, leave everything else — including
    /// `revision`, per every prior stage's "never advance locally" rule —
    /// untouched but for `updatedAt`), differing only in which terminal
    /// status they set. Mirrors the server's own `transitionTaskToTerminalStatus`
    /// exactly, including that `completedAt` is set only for the `.completed`
    /// target and never cleared once already set.
    ///
    /// Also how "delete a task" works: there is no hard-delete endpoint, so
    /// `DeleteTask` calls this with `.deleted`, producing a normal mutable-
    /// record upsert of the task's own row with its status changed — never a
    /// row deletion from the local `task` table. `task-lifecycle.ts`'s own
    /// header comment states this explicitly: "no hard-delete anywhere, only
    /// status transitions."
    func apply(to current: GardenTask, at timestamp: Date) throws -> GardenTask {
        try TaskLifecycleRules.requireEditableStatus(current)

        return GardenTask(
            id: current.id,
            gardenId: current.gardenId,
            targetKind: current.targetKind,
            targetGardenAreaMapObjectId: current.targetGardenAreaMapObjectId,
            targetPlantId: current.targetPlantId,
            title: current.title,
            notes: current.notes,
            status: status,
            dueDate: current.dueDate,
            timeWindowStart: current.timeWindowStart,
            timeWindowEnd: current.timeWindowEnd,
            recurrenceRule: current.recurrenceRule,
            urgency: current.urgency,
            source: current.source,
            originObservationId: current.originObservationId,
            revision: current.revision,
            createdByProfileId: current.createdByProfileId,
            createdAt: current.createdAt,
            updatedAt: timestamp,
            completedAt: self == .completed ? timestamp : current.completedAt
        )
    }
}
