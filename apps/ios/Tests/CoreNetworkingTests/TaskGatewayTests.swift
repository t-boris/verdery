import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the task gateway's wire shape directly against
/// `packages/api-contracts/openapi.yaml` — this app hand-writes its own
/// networking rather than consuming a generated client. Special attention to
/// `CreateManualTaskRequest.target`'s nested shape and to `editTask`'s use of
/// `FieldUpdate`.
@Suite("Task gateway")
struct TaskGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionTaskGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionTaskGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let taskJSON = #"""
        {
          "id": "task-1",
          "gardenId": "garden-1",
          "targetKind": "garden",
          "targetGardenAreaMapObjectId": null,
          "targetPlantId": null,
          "title": "Water the tomatoes",
          "notes": null,
          "status": "planned",
          "dueDate": null,
          "timeWindowStart": null,
          "timeWindowEnd": null,
          "recurrenceRule": null,
          "urgency": "normal",
          "source": "manual",
          "originObservationId": null,
          "revision": 1,
          "createdByProfileId": "profile-1",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z",
          "completedAt": null
        }
        """#

    @Test("createManualTask nests the target object by kind and posts to the tasks collection")
    func createManualTaskNestsTarget() async throws {
        let identifier = "create-task"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(201, Self.taskJSON))

        let task = try await gateway.createManualTask(
            gardenId: "garden-1",
            targetKind: .plant,
            targetGardenAreaMapObjectId: nil,
            targetPlantId: "plant-1",
            title: "Water the tomatoes",
            notes: nil,
            dueDate: "2026-07-25",
            timeWindowStart: nil,
            timeWindowEnd: nil,
            urgency: .high,
            originObservationId: nil,
            idempotencyKey: "idem-1"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks")
        #expect(request.httpMethod == "POST")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        let target = try #require(body["target"] as? [String: Any])
        #expect(target["kind"] as? String == "plant")
        #expect(target["plantId"] as? String == "plant-1")
        #expect(target["gardenAreaMapObjectId"] == nil)
        #expect(body["dueDate"] as? String == "2026-07-25")
        #expect(body["urgency"] as? String == "high")
        // No pre-existing state to distinguish "unchanged" from, so a create
        // never carries a `timeWindow` key when both bounds are `nil`.
        #expect(body["timeWindow"] == nil)

        #expect(task.id == "task-1")
    }

    @Test("createManualTask includes a timeWindow object when either bound is set")
    func createManualTaskIncludesTimeWindow() async throws {
        let identifier = "create-task-window"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(201, Self.taskJSON))

        _ = try await gateway.createManualTask(
            gardenId: "garden-1",
            targetKind: .garden,
            targetGardenAreaMapObjectId: nil,
            targetPlantId: nil,
            title: "Mow the lawn",
            notes: nil,
            dueDate: nil,
            timeWindowStart: Date(timeIntervalSince1970: 0),
            timeWindowEnd: Date(timeIntervalSince1970: 3600),
            urgency: nil,
            originObservationId: nil,
            idempotencyKey: "idem-2"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        let timeWindow = try #require(body["timeWindow"] as? [String: Any])
        #expect(timeWindow["start"] as? String == "1970-01-01T00:00:00.000Z")
        #expect(timeWindow["end"] as? String == "1970-01-01T01:00:00.000Z")
    }

    @Test("listTasksForGarden requests every status when statuses is empty")
    func listTasksForGardenOmitsStatusWhenEmpty() async throws {
        let identifier = "list-tasks-all"
        defer { StubURLProtocol.unregister(identifier) }

        let listJSON = #"{"items": [\#(Self.taskJSON)]}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, listJSON))

        let tasks = try await gateway.listTasksForGarden(gardenId: "garden-1", statuses: [])

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks")
        #expect(request.url?.query == nil)
        #expect(tasks.count == 1)
    }

    @Test("listTasksForGarden comma-joins multiple statuses into one query parameter")
    func listTasksForGardenJoinsStatuses() async throws {
        let identifier = "list-tasks-filtered"
        defer { StubURLProtocol.unregister(identifier) }

        let listJSON = #"{"items": []}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, listJSON))

        _ = try await gateway.listTasksForGarden(gardenId: "garden-1", statuses: [.planned, .suggested])

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.query == "status=planned,suggested")
    }

    @Test("editTask sends If-Match and omits fields left unchanged")
    func editTaskOmitsUnchanged() async throws {
        let identifier = "edit-task"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.taskJSON))

        _ = try await gateway.editTask(
            gardenId: "garden-1",
            taskId: "task-1",
            title: "New title",
            notes: .set(nil),
            dueDate: .unchanged,
            timeWindowStart: .unchanged,
            timeWindowEnd: .unchanged,
            urgency: nil,
            recurrenceRule: .unchanged,
            expectedRevision: 5,
            idempotencyKey: "idem-3"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks/task-1")
        #expect(request.httpMethod == "PATCH")
        #expect(request.value(forHTTPHeaderField: APIConfiguration.ifMatchHeader) == "\"5\"")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["title"] as? String == "New title")
        #expect(body["notes"] is NSNull)
        #expect(body["dueDate"] == nil)
        #expect(body["timeWindow"] == nil)
        #expect(body["urgency"] == nil)
        #expect(body["recurrenceRule"] == nil)
    }

    @Test("rescheduleTask posts dueDate and timeWindow only")
    func rescheduleTaskPostsScheduleOnly() async throws {
        let identifier = "reschedule-task"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.taskJSON))

        _ = try await gateway.rescheduleTask(
            gardenId: "garden-1",
            taskId: "task-1",
            dueDate: .set("2026-08-01"),
            timeWindowStart: .unchanged,
            timeWindowEnd: .unchanged,
            expectedRevision: 2,
            idempotencyKey: "idem-4"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks/task-1/reschedule")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["dueDate"] as? String == "2026-08-01")
        #expect(body["timeWindow"] == nil)
    }

    @Test("completeTask posts to the complete sub-resource")
    func completeTaskPostsToCompletePath() async throws {
        let identifier = "complete-task"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.taskJSON))

        _ = try await gateway.completeTask(
            gardenId: "garden-1",
            taskId: "task-1",
            completionNote: nil,
            expectedRevision: 1,
            idempotencyKey: "idem-5"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks/task-1/complete")
    }

    @Test("dismissTask posts to the dismiss sub-resource")
    func dismissTaskPostsToDismissPath() async throws {
        let identifier = "dismiss-task"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.taskJSON))

        _ = try await gateway.dismissTask(
            gardenId: "garden-1",
            taskId: "task-1",
            reason: nil,
            expectedRevision: 1,
            idempotencyKey: "idem-6"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks/task-1/dismiss")
    }

    @Test("skipTask posts to the skip sub-resource with no body")
    func skipTaskPostsToSkipPath() async throws {
        let identifier = "skip-task"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.taskJSON))

        _ = try await gateway.skipTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 1, idempotencyKey: "idem-7")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks/task-1/skip")
    }

    @Test("deleteTask posts to the delete sub-resource — a status transition, never HTTP DELETE")
    func deleteTaskPostsToDeletePath() async throws {
        let identifier = "delete-task"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.taskJSON))

        _ = try await gateway.deleteTask(gardenId: "garden-1", taskId: "task-1", expectedRevision: 1, idempotencyKey: "idem-8")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks/task-1/delete")
        #expect(request.httpMethod == "POST")
    }

    @Test("attachTaskFile posts the mediaId to the attachments sub-resource")
    func attachTaskFilePostsMediaId() async throws {
        let identifier = "attach-file"
        defer { StubURLProtocol.unregister(identifier) }

        let attachmentJSON = #"""
            {"id": "att-1", "taskId": "task-1", "mediaId": "media-1", "createdAt": "2026-01-01T00:00:00.000Z"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(201, attachmentJSON))

        let attachment = try await gateway.attachTaskFile(
            gardenId: "garden-1",
            taskId: "task-1",
            mediaId: "media-1",
            idempotencyKey: "idem-9"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/tasks/task-1/attachments")
        #expect(attachment.mediaId == "media-1")
    }
}

private struct FixedCorrelationIdentifierProvider: CorrelationIdentifierProvider {
    let value: String
    func next() -> CorrelationIdentifier { CorrelationIdentifier(value: value) }
}

private struct FakeAuthTokenProvider: AuthTokenProvider {
    let token: String?
    func currentIdToken() async throws -> String? { token }
}

extension URLRequest {
    fileprivate var httpBodyJSON: [String: Any]? {
        guard let data = httpBody, let object = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return object as? [String: Any]
    }

    fileprivate var bodyStreamJSON: [String: Any]? {
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }

        var data = Data()
        let bufferSize = 4096
        var buffer = [UInt8](repeating: 0, count: bufferSize)

        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }

        guard let object = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return object as? [String: Any]
    }
}
