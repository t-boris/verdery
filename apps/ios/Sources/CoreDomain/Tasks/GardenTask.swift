import Foundation

/// Source: packages/api-contracts/openapi.yaml, `TaskTargetKind`.
public enum TaskTargetKind: String, Codable, Equatable, Sendable, CaseIterable {
    case garden
    // The wire value is snake_case, unlike the other two cases here — the
    // contract's own literal, not a convention this client introduces.
    case gardenArea = "garden_area"
    case plant
}

/// `planned` and `suggested` are the only two statuses a task's status or
/// details may still be changed from; the other four are terminal.
///
/// Source: packages/api-contracts/openapi.yaml, `TaskStatus`.
public enum TaskStatus: String, Codable, Equatable, Sendable, CaseIterable {
    case planned
    case suggested
    case completed
    case skipped
    case dismissed
    case deleted

    /// Whether `EditTask`/`RescheduleTask`, or a status transition, is legal
    /// from this status — the same "only while planned/suggested" rule the
    /// contract documents on every mutating task operation.
    public var isMutable: Bool {
        switch self {
        case .planned, .suggested: true
        case .completed, .skipped, .dismissed, .deleted: false
        }
    }
}

/// Source: packages/api-contracts/openapi.yaml, `TaskUrgency`.
public enum TaskUrgency: String, Codable, Equatable, Sendable, CaseIterable {
    case low
    case normal
    case high
    case urgent
}

/// This API only ever creates `manual` tasks; `suggested` would originate
/// from a recommendation entity this phase does not build.
///
/// Source: packages/api-contracts/openapi.yaml, `TaskSource`.
public enum TaskSource: String, Codable, Equatable, Sendable, CaseIterable {
    case manual
    case suggested
}

/// A manual (or, in principle, suggested) task on a garden, a garden-area map
/// object, or a plant.
///
/// Named `GardenTask`, not `Task`: the bare name would shadow
/// `_Concurrency.Task`, the type every `Task { await ... }` async work item in
/// this codebase's views and view models already relies on — a collision that
/// would silently break call sites far from this file rather than fail to
/// compile in an obvious way. The `Garden`-prefixed naming this codebase
/// already uses for `GardenMapObject`, `GardenGeoreference`, and others
/// happens to sidestep the collision, not just resemble it.
///
/// `dueDate` is a calendar date (`format: date`), kept as the contract's own
/// `String` shape — see `Plant.acquisitionDate`'s doc comment for why.
///
/// Source: packages/api-contracts/openapi.yaml, `Task`.
public struct GardenTask: Equatable, Sendable, Identifiable {
    public let id: String
    public let gardenId: String
    public let targetKind: TaskTargetKind
    public let targetGardenAreaMapObjectId: String?
    public let targetPlantId: String?
    public let title: String
    public let notes: String?
    public let status: TaskStatus
    public let dueDate: String?
    public let timeWindowStart: Date?
    public let timeWindowEnd: Date?
    public let recurrenceRule: String?
    public let urgency: TaskUrgency
    public let source: TaskSource
    public let originObservationId: String?
    public let revision: Int
    public let createdByProfileId: String
    public let createdAt: Date
    public let updatedAt: Date
    public let completedAt: Date?

    public init(
        id: String,
        gardenId: String,
        targetKind: TaskTargetKind,
        targetGardenAreaMapObjectId: String?,
        targetPlantId: String?,
        title: String,
        notes: String?,
        status: TaskStatus,
        dueDate: String?,
        timeWindowStart: Date?,
        timeWindowEnd: Date?,
        recurrenceRule: String?,
        urgency: TaskUrgency,
        source: TaskSource,
        originObservationId: String?,
        revision: Int,
        createdByProfileId: String,
        createdAt: Date,
        updatedAt: Date,
        completedAt: Date?
    ) {
        self.id = id
        self.gardenId = gardenId
        self.targetKind = targetKind
        self.targetGardenAreaMapObjectId = targetGardenAreaMapObjectId
        self.targetPlantId = targetPlantId
        self.title = title
        self.notes = notes
        self.status = status
        self.dueDate = dueDate
        self.timeWindowStart = timeWindowStart
        self.timeWindowEnd = timeWindowEnd
        self.recurrenceRule = recurrenceRule
        self.urgency = urgency
        self.source = source
        self.originObservationId = originObservationId
        self.revision = revision
        self.createdByProfileId = createdByProfileId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.completedAt = completedAt
    }
}
