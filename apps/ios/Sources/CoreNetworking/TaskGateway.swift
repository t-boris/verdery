import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the manual task operations.
///
/// Features depend on this protocol, never on `URLSession` or a generated
/// client, so a feature test needs no network and no server — the same
/// reason `GardenGateway` exists.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Tasks`.
public protocol TaskGateway: Sendable {
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
    ) async throws -> GardenTask

    /// `statuses` empty returns every status — the contract's own default
    /// for an omitted filter.
    func listTasksForGarden(gardenId: String, statuses: [TaskStatus]) async throws -> [GardenTask]

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
    ) async throws -> GardenTask

    func rescheduleTask(
        gardenId: String,
        taskId: String,
        dueDate: FieldUpdate<String>,
        timeWindowStart: FieldUpdate<Date>,
        timeWindowEnd: FieldUpdate<Date>,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask

    func completeTask(
        gardenId: String,
        taskId: String,
        completionNote: String?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask

    func dismissTask(
        gardenId: String,
        taskId: String,
        reason: String?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask

    func skipTask(gardenId: String, taskId: String, expectedRevision: Int, idempotencyKey: String) async throws -> GardenTask

    /// A status transition (`'deleted'`), not a hard delete — see
    /// `packages/api-contracts/openapi.yaml`'s own description of
    /// `deleteTask`. Named to match the contract's operation, not to imply
    /// the row disappears.
    func deleteTask(gardenId: String, taskId: String, expectedRevision: Int, idempotencyKey: String) async throws -> GardenTask

    /// See `FeatureTasks`'s doc comment on the (deliberately absent)
    /// attachment UI for why this method has no entry point this pass, even
    /// though it is fully implemented and tested here.
    func attachTaskFile(
        gardenId: String,
        taskId: String,
        mediaId: String,
        idempotencyKey: String
    ) async throws -> TaskAttachment
}

/// URLSession-backed implementation of the manual task operations.
public struct URLSessionTaskGateway: TaskGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func createManualTask(
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
        let result: GardenTaskTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/tasks",
            body: CreateManualTaskRequestTransport(
                target: TaskTargetRequestTransport(
                    kind: targetKind,
                    gardenAreaMapObjectId: targetGardenAreaMapObjectId,
                    plantId: targetPlantId
                ),
                title: title,
                notes: notes,
                dueDate: dueDate,
                timeWindow: Self.timeWindowTransport(start: timeWindowStart, end: timeWindowEnd),
                urgency: urgency,
                originObservationId: originObservationId
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func listTasksForGarden(gardenId: String, statuses: [TaskStatus]) async throws -> [GardenTask] {
        var path = "gardens/\(gardenId)/tasks"
        if !statuses.isEmpty {
            path += "?status=" + statuses.map(\.rawValue).joined(separator: ",")
        }

        let result: TaskListResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return result.items.map(\.domainValue)
    }

    public func editTask(
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
        let result: GardenTaskTransport = try await transport.send(
            method: "PATCH",
            operationPath: "gardens/\(gardenId)/tasks/\(taskId)",
            body: EditTaskRequestTransport(
                title: title,
                notes: notes,
                dueDate: dueDate,
                timeWindow: Self.timeWindowTransport(fieldUpdateStart: timeWindowStart, fieldUpdateEnd: timeWindowEnd),
                urgency: urgency,
                recurrenceRule: recurrenceRule
            ),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func rescheduleTask(
        gardenId: String,
        taskId: String,
        dueDate: FieldUpdate<String>,
        timeWindowStart: FieldUpdate<Date>,
        timeWindowEnd: FieldUpdate<Date>,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let result: GardenTaskTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/tasks/\(taskId)/reschedule",
            body: RescheduleTaskRequestTransport(
                dueDate: dueDate,
                timeWindow: Self.timeWindowTransport(fieldUpdateStart: timeWindowStart, fieldUpdateEnd: timeWindowEnd)
            ),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func completeTask(
        gardenId: String,
        taskId: String,
        completionNote: String?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let result: GardenTaskTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/tasks/\(taskId)/complete",
            body: CompleteTaskRequestTransport(completionNote: completionNote),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func dismissTask(
        gardenId: String,
        taskId: String,
        reason: String?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let result: GardenTaskTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/tasks/\(taskId)/dismiss",
            body: DismissTaskRequestTransport(reason: reason),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func skipTask(
        gardenId: String,
        taskId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let result: GardenTaskTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/tasks/\(taskId)/skip",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func deleteTask(
        gardenId: String,
        taskId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> GardenTask {
        let result: GardenTaskTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/tasks/\(taskId)/delete",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func attachTaskFile(
        gardenId: String,
        taskId: String,
        mediaId: String,
        idempotencyKey: String
    ) async throws -> TaskAttachment {
        let result: TaskAttachmentTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/tasks/\(taskId)/attachments",
            body: AttachTaskFileRequestTransport(mediaId: mediaId),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    private func revisionHeaders(expectedRevision: Int, idempotencyKey: String) -> [String: String] {
        [
            APIConfiguration.idempotencyKeyHeader: idempotencyKey,
            APIConfiguration.ifMatchHeader: "\"\(expectedRevision)\"",
        ]
    }

    /// Builds a `timeWindow` object for a create request from plain
    /// optionals — `nil` for both means "omit `timeWindow` entirely," since a
    /// create has no existing window to distinguish "leave unchanged" from.
    private static func timeWindowTransport(start: Date?, end: Date?) -> TaskTimeWindowRequestTransport? {
        guard start != nil || end != nil else { return nil }
        return TaskTimeWindowRequestTransport(start: .set(start), end: .set(end))
    }

    /// Builds a `timeWindow` object for an edit/reschedule request from
    /// ``FieldUpdate``s — `.unchanged` for both means "omit `timeWindow`
    /// entirely," leaving the existing window untouched.
    private static func timeWindowTransport(
        fieldUpdateStart: FieldUpdate<Date>,
        fieldUpdateEnd: FieldUpdate<Date>
    ) -> TaskTimeWindowRequestTransport? {
        if case .unchanged = fieldUpdateStart, case .unchanged = fieldUpdateEnd { return nil }
        return TaskTimeWindowRequestTransport(start: fieldUpdateStart, end: fieldUpdateEnd)
    }
}
