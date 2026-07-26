import CoreDomain
import Foundation

/// Wire shapes of the task operations. See `PlantTransport.swift`'s doc
/// comment for why these enums code by straight synthesis, and
/// `FieldUpdate`'s doc comment for the omit-vs-null distinction several of
/// the request bodies below need.
///
/// Named to match `CoreDomain.GardenTask`, not the contract's own `Task`
/// schema name — see that type's doc comment on why `Task` alone cannot be
/// used anywhere in this codebase.
///
/// Source: packages/api-contracts/openapi.yaml, tag `Tasks`.
struct GardenTaskTransport: Codable {
    let id: String
    let gardenId: String
    let targetKind: TaskTargetKind
    let targetGardenAreaMapObjectId: String?
    let targetPlantId: String?
    let title: String
    let notes: String?
    let status: TaskStatus
    let dueDate: String?
    let timeWindowStart: Date?
    let timeWindowEnd: Date?
    let recurrenceRule: String?
    let urgency: TaskUrgency
    let source: TaskSource
    let originObservationId: String?
    let revision: Int
    let createdByProfileId: String
    let createdAt: Date
    let updatedAt: Date
    let completedAt: Date?
    /// Added for P9A-TASK-01. All three are plain `Codable` optionals, not a
    /// custom decoder: the contract lists them as `required` (always present,
    /// `null` or a value) rather than omittable, which is exactly what a
    /// synthesized `Optional` property already decodes correctly.
    let assignedProfileId: String?
    let assignedAt: Date?
    let completedByProfileId: String?

    var domainValue: GardenTask {
        GardenTask(
            id: id,
            gardenId: gardenId,
            targetKind: targetKind,
            targetGardenAreaMapObjectId: targetGardenAreaMapObjectId,
            targetPlantId: targetPlantId,
            title: title,
            notes: notes,
            status: status,
            dueDate: dueDate,
            timeWindowStart: timeWindowStart,
            timeWindowEnd: timeWindowEnd,
            recurrenceRule: recurrenceRule,
            urgency: urgency,
            source: source,
            originObservationId: originObservationId,
            revision: revision,
            createdByProfileId: createdByProfileId,
            createdAt: createdAt,
            updatedAt: updatedAt,
            completedAt: completedAt,
            assignedProfileId: assignedProfileId,
            assignedAt: assignedAt,
            completedByProfileId: completedByProfileId
        )
    }
}

struct TaskListResultTransport: Decodable {
    let items: [GardenTaskTransport]
}

struct TaskAttachmentTransport: Codable {
    let id: String
    let taskId: String
    let mediaId: String
    let createdAt: Date

    var domainValue: TaskAttachment {
        TaskAttachment(id: id, taskId: taskId, mediaId: mediaId, createdAt: createdAt)
    }
}

/// Shared by create/edit/reschedule request bodies. `start`/`end` use
/// ``FieldUpdate`` for the same omit-vs-null reason `UpdatePlantDetailsRequestTransport`
/// does; a create body simply never needs `.unchanged`.
struct TaskTimeWindowRequestTransport: Encodable {
    let start: FieldUpdate<Date>
    let end: FieldUpdate<Date>

    private enum CodingKeys: String, CodingKey { case start, end }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
    }
}

struct TaskTargetRequestTransport: Encodable {
    let kind: TaskTargetKind
    let gardenAreaMapObjectId: String?
    let plantId: String?
}

struct CreateManualTaskRequestTransport: Encodable {
    let target: TaskTargetRequestTransport
    let title: String
    let notes: String?
    let dueDate: String?
    let timeWindow: TaskTimeWindowRequestTransport?
    let urgency: TaskUrgency?
    let originObservationId: String?
}

/// `title` stays a plain optional — the contract does not make it nullable,
/// only omittable — while every nullable field uses ``FieldUpdate``.
struct EditTaskRequestTransport: Encodable {
    let title: String?
    let notes: FieldUpdate<String>
    let dueDate: FieldUpdate<String>
    let timeWindow: TaskTimeWindowRequestTransport?
    let urgency: TaskUrgency?
    let recurrenceRule: FieldUpdate<String>

    private enum CodingKeys: String, CodingKey {
        case title, notes, dueDate, timeWindow, urgency, recurrenceRule
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(title, forKey: .title)
        try container.encode(notes, forKey: .notes)
        try container.encode(dueDate, forKey: .dueDate)
        try container.encodeIfPresent(timeWindow, forKey: .timeWindow)
        try container.encodeIfPresent(urgency, forKey: .urgency)
        try container.encode(recurrenceRule, forKey: .recurrenceRule)
    }
}

struct RescheduleTaskRequestTransport: Encodable {
    let dueDate: FieldUpdate<String>
    let timeWindow: TaskTimeWindowRequestTransport?

    private enum CodingKeys: String, CodingKey { case dueDate, timeWindow }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dueDate, forKey: .dueDate)
        try container.encodeIfPresent(timeWindow, forKey: .timeWindow)
    }
}

struct CompleteTaskRequestTransport: Encodable {
    let completionNote: String?
}

struct DismissTaskRequestTransport: Encodable {
    let reason: String?
}

struct AttachTaskFileRequestTransport: Encodable {
    let mediaId: String
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `AssignTaskRequest`:
/// `assigneeProfileId` is required, and `nil` is how a caller explicitly
/// unassigns — never a shorthand for "no change" the way `FieldUpdate`
/// distinguishes elsewhere on this tag. A custom encoder is what that
/// requires: the compiler's synthesized `Encodable` conformance treats a
/// plain `String?` stored property as omittable (`encodeIfPresent`
/// semantics) and would drop the key entirely for `nil`, silently turning an
/// unassign request into a no-op body. Calling the generic
/// `container.encode(_:forKey:)` instead — not `encodeIfPresent` — invokes
/// `Optional`'s own `Encodable` conformance, which writes a literal `null`
/// for `nil` rather than omitting the key.
struct AssignTaskRequestTransport: Encodable {
    let assigneeProfileId: String?

    private enum CodingKeys: String, CodingKey { case assigneeProfileId }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(assigneeProfileId, forKey: .assigneeProfileId)
    }
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `TaskActivityEntry`.
struct TaskActivityEntryTransport: Decodable {
    let revision: Int
    let commandType: TaskActivityCommandType
    let actorProfileId: String
    let status: TaskStatus?
    let dueDate: String?
    let assignedProfileId: String?
    let recordedAt: Date

    var domainValue: TaskActivityEntry {
        TaskActivityEntry(
            revision: revision,
            commandType: commandType,
            actorProfileId: actorProfileId,
            status: status,
            dueDate: dueDate,
            assignedProfileId: assignedProfileId,
            recordedAt: recordedAt
        )
    }
}

struct TaskActivityListResultTransport: Decodable {
    let items: [TaskActivityEntryTransport]
}
