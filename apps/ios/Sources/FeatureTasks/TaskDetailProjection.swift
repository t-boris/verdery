import CoreDomain
import CoreNetworking
import Foundation

/// Fields `EditTask`/`RescheduleTask` may change — a client-side mirror of
/// the server's own `TaskDetailChanges` (`tasks-recommendations/domain/task.ts`).
/// `nil`/`.unchanged` means "leave unchanged"; `.set(nil)` on a nullable
/// field clears it. `RescheduleTask` only ever populates `dueDate`/
/// `timeWindowStart`/`timeWindowEnd`, leaving the rest at their defaults;
/// `EditTask` may populate any of them — the same relationship the server's
/// own `RescheduleTaskInput`/`EditTaskChanges` have to this shared shape.
struct TaskDetailChanges {
    var title: String?
    var notes: FieldUpdate<String> = .unchanged
    var dueDate: FieldUpdate<String> = .unchanged
    var timeWindowStart: FieldUpdate<Date> = .unchanged
    var timeWindowEnd: FieldUpdate<Date> = .unchanged
    var urgency: TaskUrgency?
    var recurrenceRule: FieldUpdate<String> = .unchanged
}

/// Shared local projection for `EditTask` and `RescheduleTask`: both commands
/// change only scheduling/detail fields (never `status`) through the same
/// function — mirroring the server's own `updateTaskDetails`
/// (`tasks-recommendations/domain/task.ts`) and the shared revision-guard/
/// journal-append plumbing both commands route through server-side via
/// `apply-task-detail-changes.ts` — so the "guard the status, apply the
/// change" logic lives once here instead of twice, the same factoring this
/// codebase's own server-side code already established for these two
/// commands specifically.
enum TaskDetailProjection {
    static func apply(_ changes: TaskDetailChanges, to current: GardenTask, at timestamp: Date) throws -> GardenTask {
        try TaskLifecycleRules.requireEditableStatus(current)

        return GardenTask(
            id: current.id,
            gardenId: current.gardenId,
            targetKind: current.targetKind,
            targetGardenAreaMapObjectId: current.targetGardenAreaMapObjectId,
            targetPlantId: current.targetPlantId,
            title: changes.title ?? current.title,
            notes: applying(changes.notes, to: current.notes),
            status: current.status,
            dueDate: applying(changes.dueDate, to: current.dueDate),
            timeWindowStart: applying(changes.timeWindowStart, to: current.timeWindowStart),
            timeWindowEnd: applying(changes.timeWindowEnd, to: current.timeWindowEnd),
            recurrenceRule: applying(changes.recurrenceRule, to: current.recurrenceRule),
            urgency: changes.urgency ?? current.urgency,
            source: current.source,
            originObservationId: current.originObservationId,
            // Unchanged locally — the server, not this client, assigns the
            // next revision, which this device only learns once the push
            // that would consume this outbox operation is accepted. The same
            // `unconfirmedTaskRevision`/"never advance locally" rule every
            // prior stage's mutable-record commands share.
            revision: current.revision,
            createdByProfileId: current.createdByProfileId,
            createdAt: current.createdAt,
            updatedAt: timestamp,
            completedAt: current.completedAt
        )
    }
}

/// Applies a `FieldUpdate` to a current optional value: `.unchanged` keeps
/// `current`, `.set(value)` (including `.set(nil)`, which clears it) becomes
/// the new value — mirrors `FeaturePlants`'s identical private helper of the
/// same name, and the backend's own `changes.field !== undefined ? ... :
/// task.field` handling in `updateTaskDetails`.
private func applying<Value>(_ update: FieldUpdate<Value>, to current: Value?) -> Value? {
    switch update {
    case .unchanged: current
    case let .set(value): value
    }
}
