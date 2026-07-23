import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for the manual task operations this pass gives a UI to.
///
/// `AttachTaskFile` has no use case here, even though `TaskGateway`
/// implements and tests it: it needs a `mediaId` this client has no way to
/// produce yet (see `TasksListView`'s doc comment), so a use case with
/// nothing above it that could ever call it would be dead code, not a
/// completed vertical slice — the same reasoning `FeaturePlants`'s doc
/// comment gives for its own four gateway-only operations.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, tag `Tasks`.
public struct CreateManualTask: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        targetKind: TaskTargetKind,
        targetGardenAreaMapObjectId: String? = nil,
        targetPlantId: String? = nil,
        title: String,
        notes: String? = nil,
        dueDate: String? = nil,
        timeWindowStart: Date? = nil,
        timeWindowEnd: Date? = nil,
        urgency: TaskUrgency? = nil,
        originObservationId: String? = nil
    ) async throws -> GardenTask {
        try await gateway.createManualTask(
            gardenId: gardenId,
            targetKind: targetKind,
            targetGardenAreaMapObjectId: targetGardenAreaMapObjectId,
            targetPlantId: targetPlantId,
            title: title,
            notes: notes,
            dueDate: dueDate,
            timeWindowStart: timeWindowStart,
            timeWindowEnd: timeWindowEnd,
            urgency: urgency,
            originObservationId: originObservationId,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct ListTasksForGarden: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, statuses: [TaskStatus] = []) async throws -> [GardenTask] {
        try await gateway.listTasksForGarden(gardenId: gardenId, statuses: statuses)
    }
}

public struct EditTask: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        taskId: String,
        title: String? = nil,
        notes: FieldUpdate<String> = .unchanged,
        dueDate: FieldUpdate<String> = .unchanged,
        timeWindowStart: FieldUpdate<Date> = .unchanged,
        timeWindowEnd: FieldUpdate<Date> = .unchanged,
        urgency: TaskUrgency? = nil,
        recurrenceRule: FieldUpdate<String> = .unchanged,
        expectedRevision: Int
    ) async throws -> GardenTask {
        try await gateway.editTask(
            gardenId: gardenId,
            taskId: taskId,
            title: title,
            notes: notes,
            dueDate: dueDate,
            timeWindowStart: timeWindowStart,
            timeWindowEnd: timeWindowEnd,
            urgency: urgency,
            recurrenceRule: recurrenceRule,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct RescheduleTask: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        taskId: String,
        dueDate: FieldUpdate<String> = .unchanged,
        timeWindowStart: FieldUpdate<Date> = .unchanged,
        timeWindowEnd: FieldUpdate<Date> = .unchanged,
        expectedRevision: Int
    ) async throws -> GardenTask {
        try await gateway.rescheduleTask(
            gardenId: gardenId,
            taskId: taskId,
            dueDate: dueDate,
            timeWindowStart: timeWindowStart,
            timeWindowEnd: timeWindowEnd,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// `completionNote` is always `nil` from this use case — see
/// `TasksListView`'s doc comment on why no note-collection UI sits above it.
public struct CompleteTask: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, taskId: String, expectedRevision: Int) async throws -> GardenTask {
        try await gateway.completeTask(
            gardenId: gardenId,
            taskId: taskId,
            completionNote: nil,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// `reason` is always `nil` from this use case — the same carve-out
/// `CompleteTask` documents.
public struct DismissTask: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, taskId: String, expectedRevision: Int) async throws -> GardenTask {
        try await gateway.dismissTask(
            gardenId: gardenId,
            taskId: taskId,
            reason: nil,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

public struct SkipTask: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, taskId: String, expectedRevision: Int) async throws -> GardenTask {
        try await gateway.skipTask(
            gardenId: gardenId,
            taskId: taskId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}

/// Also how "delete a task" works: there is no hard-delete endpoint, so the
/// list's delete action calls this, not a nonexistent `DELETE`.
public struct DeleteTask: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, taskId: String, expectedRevision: Int) async throws -> GardenTask {
        try await gateway.deleteTask(
            gardenId: gardenId,
            taskId: taskId,
            expectedRevision: expectedRevision,
            idempotencyKey: UUIDv7.generate()
        )
    }
}
