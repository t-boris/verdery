import CoreDomain
import CoreNetworking
import Foundation

/// The wire shape of a task outbox operation's stored payload
/// (`OutboxOperation.payload`).
///
/// Mirrors `packages/api-contracts/openapi.yaml`'s `SyncTaskOperationPayload`
/// / `SyncTaskCommand` exactly — `recordType`, `gardenId`, and every
/// `commandType` string are the contract's own discriminator values, copied
/// verbatim, not re-derived at push time, and every one was read directly
/// from the YAML rather than guessed — the same discipline Stage 4a caught
/// `gardens.delete_request` with, Stage 4b caught `recordType: "gardenObject"`
/// with, and Stage 4c caught `plants.updateDetails` with. Unlike those three,
/// every `tasks.*` discriminator here IS the naive camelCase guess
/// (`tasks.createManualTask`, `tasks.editTask`, `tasks.rescheduleTask`,
/// `tasks.completeTask`, `tasks.dismissTask`, `tasks.skipTask`,
/// `tasks.deleteTask`) and `recordType` IS the guessable singular `"task"` —
/// confirmed against the contract, not assumed to be safe because prior
/// stages found surprises. `tasks.attachTaskFile` has no case here — see
/// `TasksUseCases.swift`'s doc comment for why `AttachTaskFile` is out of
/// scope this stage.
///
/// Request-body wire types here (`CreateManualTaskRequestPayload`, ...) are
/// new, feature-local structs rather than a reuse of `CoreNetworking`'s own
/// `CreateManualTaskRequestTransport`/`EditTaskRequestTransport`/...: those
/// stay `internal` to `CoreNetworking`, and — like `FeaturePlants`'s
/// identical judgment call for its own five request bodies — these are
/// small, flat structs a second field-for-field copy does not meaningfully
/// risk drifting from the contract.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation" ("Canonical payload"); packages/api-contracts/openapi.yaml,
/// `SyncTaskOperationPayload`, `SyncTaskCommand` and its eight branches
/// (seven of which this stage builds — see `TasksUseCases.swift`).
struct TaskSyncOperationPayload: Encodable {
    let gardenId: String
    let command: TaskSyncCommand

    private enum CodingKeys: String, CodingKey {
        case recordType, gardenId, command
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // The contract's `SyncTaskOperationPayload.recordType` discriminator
        // — always the literal `"task"` for this payload family.
        try container.encode("task", forKey: .recordType)
        try container.encode(gardenId, forKey: .gardenId)
        try container.encode(command, forKey: .command)
    }
}

/// One `SyncTaskCommand` branch — the seven this stage's offline commands
/// build. `tasks.attachTaskFile` (`SyncAttachTaskFileCommand`) has no case
/// here — see `TasksUseCases.swift`'s doc comment for why `AttachTaskFile`
/// is not reachable from any shipped UI today. `skipTask`/`deleteTask` carry
/// no `request` at all, matching `SyncSkipTaskCommand`/`SyncDeleteTaskCommand`
/// having no `request` property in the contract — `SkipTask`/`DeleteTask`
/// themselves take only `If-Match` online too.
enum TaskSyncCommand: Encodable {
    case createManualTask(taskId: String, request: CreateManualTaskRequestPayload)
    case editTask(taskId: String, expectedRevision: Int, request: EditTaskRequestPayload)
    case rescheduleTask(taskId: String, expectedRevision: Int, request: RescheduleTaskRequestPayload)
    case completeTask(taskId: String, expectedRevision: Int, request: CompleteTaskRequestPayload)
    case dismissTask(taskId: String, expectedRevision: Int, request: DismissTaskRequestPayload)
    case skipTask(taskId: String, expectedRevision: Int)
    case deleteTask(taskId: String, expectedRevision: Int)

    private enum CodingKeys: String, CodingKey {
        case commandType, taskId, expectedRevision, request
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .createManualTask(taskId, request):
            try container.encode("tasks.createManualTask", forKey: .commandType)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(request, forKey: .request)

        case let .editTask(taskId, expectedRevision, request):
            try container.encode("tasks.editTask", forKey: .commandType)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(request, forKey: .request)

        case let .rescheduleTask(taskId, expectedRevision, request):
            try container.encode("tasks.rescheduleTask", forKey: .commandType)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(request, forKey: .request)

        case let .completeTask(taskId, expectedRevision, request):
            try container.encode("tasks.completeTask", forKey: .commandType)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(request, forKey: .request)

        case let .dismissTask(taskId, expectedRevision, request):
            try container.encode("tasks.dismissTask", forKey: .commandType)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(request, forKey: .request)

        case let .skipTask(taskId, expectedRevision):
            try container.encode("tasks.skipTask", forKey: .commandType)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(expectedRevision, forKey: .expectedRevision)

        case let .deleteTask(taskId, expectedRevision):
            try container.encode("tasks.deleteTask", forKey: .commandType)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
        }
    }
}

/// Shared by create/edit/reschedule request bodies — mirrors
/// `CoreNetworking.TaskTimeWindowRequestTransport`'s identical shape.
struct TaskTimeWindowRequestPayload: Encodable {
    let start: FieldUpdate<Date>
    let end: FieldUpdate<Date>

    private enum CodingKeys: String, CodingKey { case start, end }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
    }
}

struct TaskTargetRequestPayload: Encodable {
    let kind: TaskTargetKind
    let gardenAreaMapObjectId: String?
    let plantId: String?
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `CreateManualTaskRequest`
/// exactly.
struct CreateManualTaskRequestPayload: Encodable {
    let target: TaskTargetRequestPayload
    let title: String
    let notes: String?
    let dueDate: String?
    let timeWindow: TaskTimeWindowRequestPayload?
    let urgency: TaskUrgency?
    let originObservationId: String?
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `EditTaskRequest` exactly,
/// including its `title`-stays-plain-optional-while-everything-else-is-
/// `FieldUpdate` shape — the identical distinction
/// `CoreNetworking.EditTaskRequestTransport`'s own doc comment draws (the
/// contract does not make `title` nullable, only omittable).
struct EditTaskRequestPayload: Encodable {
    let title: String?
    let notes: FieldUpdate<String>
    let dueDate: FieldUpdate<String>
    let timeWindow: TaskTimeWindowRequestPayload?
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

/// Mirrors `packages/api-contracts/openapi.yaml`'s `RescheduleTaskRequest`
/// exactly.
struct RescheduleTaskRequestPayload: Encodable {
    let dueDate: FieldUpdate<String>
    let timeWindow: TaskTimeWindowRequestPayload?

    private enum CodingKeys: String, CodingKey { case dueDate, timeWindow }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dueDate, forKey: .dueDate)
        try container.encodeIfPresent(timeWindow, forKey: .timeWindow)
    }
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `CompleteTaskRequest`:
/// `completionNote` is always `nil` from this client — see `TasksUseCases
/// .swift`'s doc comment on `CompleteTask` for the carve-out this mirrors
/// from the online gateway path — which the synthesized `Encodable`
/// conformance simply omits from the wire, matching the schema's own "no
/// required properties" shape.
struct CompleteTaskRequestPayload: Encodable {
    let completionNote: String?
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `DismissTaskRequest` —
/// the same `reason`-always-`nil`-and-omitted carve-out `CompleteTaskRequestPayload`
/// documents.
struct DismissTaskRequestPayload: Encodable {
    let reason: String?
}

enum TaskSyncCommandPayload {
    /// The command-payload version every task outbox operation is currently
    /// authored under — see `FeatureGardens.GardenSyncCommandPayload.version`'s
    /// identical reasoning.
    static let version = 1

    /// Encodes a `TaskSyncOperationPayload` to the UTF-8 JSON text stored in
    /// `OutboxOperation.payload`.
    static func encode(gardenId: String, command: TaskSyncCommand) throws -> String {
        let payload = TaskSyncOperationPayload(gardenId: gardenId, command: command)
        let data = try JSONEncoder().encode(payload)

        guard let text = String(data: data, encoding: .utf8) else {
            throw TaskCommandError.payloadEncodingFailed
        }

        return text
    }

    /// Builds a `timeWindow` object for a create request from plain
    /// optionals — mirrors `CoreNetworking.URLSessionTaskGateway
    /// .timeWindowTransport(start:end:)`: `nil` for both means omit
    /// `timeWindow` entirely, since a create has no existing window to
    /// distinguish "leave unchanged" from.
    static func createTimeWindow(start: Date?, end: Date?) -> TaskTimeWindowRequestPayload? {
        guard start != nil || end != nil else { return nil }
        return TaskTimeWindowRequestPayload(start: .set(start), end: .set(end))
    }

    /// Builds a `timeWindow` object for an edit/reschedule request from
    /// ``FieldUpdate``s — mirrors `CoreNetworking.URLSessionTaskGateway
    /// .timeWindowTransport(fieldUpdateStart:fieldUpdateEnd:)`: `.unchanged`
    /// for both means omit `timeWindow` entirely, leaving the existing
    /// window untouched.
    static func fieldUpdateTimeWindow(start: FieldUpdate<Date>, end: FieldUpdate<Date>) -> TaskTimeWindowRequestPayload? {
        if case .unchanged = start, case .unchanged = end { return nil }
        return TaskTimeWindowRequestPayload(start: start, end: end)
    }
}
