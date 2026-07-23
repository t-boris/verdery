import CoreDomain
import CoreNetworking
import Foundation

/// In-memory, non-networked stand-in for the real API — mirrors
/// `FeaturePlantsTests/FakePlantGateway`'s role for `FeatureTasks`'s own
/// view-model tests. Enforces the same "only while planned/suggested"
/// terminal-status rule the real service does, so a test can tell a correct
/// guard from a broken one.
final class FakeTaskGateway: TaskGateway, @unchecked Sendable {
    private var tasks: [String: GardenTask]

    init(tasks: [GardenTask] = []) {
        self.tasks = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0) })
    }

    func createManualTask(
        gardenId: String,
        targetKind: TaskTargetKind,
        targetGardenAreaMapObjectId: String?,
        targetPlantId: String?,
        title: String,
        notes: String?,
        dueDate: String?,
        timeWindowStart: Date?,
        timeWindowEnd: Date?,
        urgency: TaskUrgency?,
        originObservationId: String?,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let task = GardenTask(
            id: "task-\(tasks.count + 1)", gardenId: gardenId, targetKind: targetKind,
            targetGardenAreaMapObjectId: targetGardenAreaMapObjectId, targetPlantId: targetPlantId, title: title,
            notes: notes, status: .planned, dueDate: dueDate, timeWindowStart: timeWindowStart,
            timeWindowEnd: timeWindowEnd, recurrenceRule: nil, urgency: urgency ?? .normal, source: .manual,
            originObservationId: originObservationId, revision: 1, createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0), completedAt: nil
        )
        tasks[task.id] = task
        return task
    }

    func listTasksForGarden(gardenId: String, statuses: [TaskStatus]) async throws -> [GardenTask] {
        guard !statuses.isEmpty else { return Array(tasks.values) }
        return tasks.values.filter { statuses.contains($0.status) }
    }

    func editTask(
        gardenId: String,
        taskId: String,
        title: String?,
        notes: FieldUpdate<String>,
        dueDate: FieldUpdate<String>,
        timeWindowStart: FieldUpdate<Date>,
        timeWindowEnd: FieldUpdate<Date>,
        urgency: TaskUrgency?,
        recurrenceRule: FieldUpdate<String>,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let task = try expectMutable(taskId, expectedRevision)
        let updated = GardenTask(
            id: task.id, gardenId: task.gardenId, targetKind: task.targetKind,
            targetGardenAreaMapObjectId: task.targetGardenAreaMapObjectId, targetPlantId: task.targetPlantId,
            title: title ?? task.title, notes: resolved(notes, current: task.notes),
            status: task.status, dueDate: resolved(dueDate, current: task.dueDate),
            timeWindowStart: resolved(timeWindowStart, current: task.timeWindowStart),
            timeWindowEnd: resolved(timeWindowEnd, current: task.timeWindowEnd),
            recurrenceRule: resolved(recurrenceRule, current: task.recurrenceRule), urgency: urgency ?? task.urgency,
            source: task.source, originObservationId: task.originObservationId, revision: task.revision + 1,
            createdByProfileId: task.createdByProfileId, createdAt: task.createdAt, updatedAt: task.updatedAt,
            completedAt: task.completedAt
        )
        tasks[task.id] = updated
        return updated
    }

    func rescheduleTask(
        gardenId: String,
        taskId: String,
        dueDate: FieldUpdate<String>,
        timeWindowStart: FieldUpdate<Date>,
        timeWindowEnd: FieldUpdate<Date>,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let task = try expectMutable(taskId, expectedRevision)
        let updated = withSchedule(task, dueDate: resolved(dueDate, current: task.dueDate), start: resolved(timeWindowStart, current: task.timeWindowStart), end: resolved(timeWindowEnd, current: task.timeWindowEnd))
        tasks[task.id] = updated
        return updated
    }

    func completeTask(gardenId: String, taskId: String, completionNote: String?, expectedRevision: Int, idempotencyKey: String) async throws -> GardenTask {
        let task = try expectMutable(taskId, expectedRevision)
        let updated = withStatus(task, .completed)
        tasks[task.id] = updated
        return updated
    }

    func dismissTask(gardenId: String, taskId: String, reason: String?, expectedRevision: Int, idempotencyKey: String) async throws -> GardenTask {
        let task = try expectMutable(taskId, expectedRevision)
        let updated = withStatus(task, .dismissed)
        tasks[task.id] = updated
        return updated
    }

    func skipTask(gardenId: String, taskId: String, expectedRevision: Int, idempotencyKey: String) async throws -> GardenTask {
        let task = try expectMutable(taskId, expectedRevision)
        let updated = withStatus(task, .skipped)
        tasks[task.id] = updated
        return updated
    }

    func deleteTask(gardenId: String, taskId: String, expectedRevision: Int, idempotencyKey: String) async throws -> GardenTask {
        let task = try expectMutable(taskId, expectedRevision)
        let updated = withStatus(task, .deleted)
        tasks[task.id] = updated
        return updated
    }

    func attachTaskFile(gardenId: String, taskId: String, mediaId: String, idempotencyKey: String) async throws -> TaskAttachment {
        TaskAttachment(id: "attachment-1", taskId: taskId, mediaId: mediaId, createdAt: Date(timeIntervalSince1970: 0))
    }

    private func resolved<Value>(_ fieldUpdate: FieldUpdate<Value>, current: Value?) -> Value? {
        switch fieldUpdate {
        case .unchanged: current
        case let .set(value): value
        }
    }

    private func expectMutable(_ taskId: String, _ expectedRevision: Int) throws -> GardenTask {
        guard let task = tasks[taskId], task.revision == expectedRevision else {
            throw APIGatewayError.unexpectedStatus(409, correlationId: "fake-conflict")
        }
        guard task.status.isMutable else {
            throw APIGatewayError.unexpectedStatus(409, correlationId: "fake-terminal-status")
        }
        return task
    }

    private func withStatus(_ task: GardenTask, _ status: TaskStatus) -> GardenTask {
        GardenTask(
            id: task.id, gardenId: task.gardenId, targetKind: task.targetKind,
            targetGardenAreaMapObjectId: task.targetGardenAreaMapObjectId, targetPlantId: task.targetPlantId,
            title: task.title, notes: task.notes, status: status, dueDate: task.dueDate,
            timeWindowStart: task.timeWindowStart, timeWindowEnd: task.timeWindowEnd,
            recurrenceRule: task.recurrenceRule, urgency: task.urgency, source: task.source,
            originObservationId: task.originObservationId, revision: task.revision + 1,
            createdByProfileId: task.createdByProfileId, createdAt: task.createdAt, updatedAt: task.updatedAt,
            completedAt: status == .completed ? Date(timeIntervalSince1970: 1) : task.completedAt
        )
    }

    private func withSchedule(_ task: GardenTask, dueDate: String?, start: Date?, end: Date?) -> GardenTask {
        GardenTask(
            id: task.id, gardenId: task.gardenId, targetKind: task.targetKind,
            targetGardenAreaMapObjectId: task.targetGardenAreaMapObjectId, targetPlantId: task.targetPlantId,
            title: task.title, notes: task.notes, status: task.status, dueDate: dueDate,
            timeWindowStart: start, timeWindowEnd: end, recurrenceRule: task.recurrenceRule, urgency: task.urgency,
            source: task.source, originObservationId: task.originObservationId, revision: task.revision + 1,
            createdByProfileId: task.createdByProfileId, createdAt: task.createdAt, updatedAt: task.updatedAt,
            completedAt: task.completedAt
        )
    }
}
