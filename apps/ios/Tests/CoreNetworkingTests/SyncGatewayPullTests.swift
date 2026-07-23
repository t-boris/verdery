import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// `SyncGateway.getChanges` (`GET /sync/changes`) coverage — split out of
/// `SyncGatewayTests.swift` for this codebase's own file-size discipline
/// (`node scripts/check-file-size.mjs`'s 600-line ceiling), the same way
/// `MapEditorViewModelSaveStatusTests.swift` already splits out of
/// `MapEditorViewModelTests.swift`. P5-IOS-03, Stage 5b.
@Suite("Sync gateway — pull")
struct SyncGatewayPullTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionSyncGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionSyncGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    @Test("getChanges GETs sync/changes with limit and protocolVersion, omitting after when nil")
    func getChangesOmitsAfterWhenNil() async throws {
        let identifier = "get-changes-no-after"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"items":[],"nextCursor":"cursor-1"}"#))

        _ = try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 50)

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.httpMethod == "GET")
        #expect(request.url?.path == "/v1/sync/changes")
        let query = try #require(request.url?.query)
        #expect(query.contains("limit=50"))
        #expect(query.contains("protocolVersion=1"))
        #expect(!query.contains("after="))
    }

    @Test("getChanges includes a percent-encoded after cursor when present")
    func getChangesIncludesAfterWhenPresent() async throws {
        let identifier = "get-changes-with-after"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"items":[],"nextCursor":"cursor-2"}"#))

        _ = try await gateway.getChanges(protocolVersion: 1, after: "cursor one/two", limit: 100)

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let query = try #require(request.url?.query)
        #expect(query.contains("after=cursor%20one/two") || query.contains("after=cursor%20one%2Ftwo"))
    }

    @Test("getChanges decodes an empty page's own nextCursor even with no items")
    func getChangesDecodesEmptyPage() async throws {
        let identifier = "get-changes-empty"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"items":[],"nextCursor":"cursor-caught-up"}"#))

        let page = try await gateway.getChanges(protocolVersion: 1, after: "cursor-0", limit: 100)

        #expect(page.items.isEmpty)
        #expect(page.nextCursor == "cursor-caught-up")
    }

    @Test("getChanges decodes an upsert garden change into a typed Garden snapshot")
    func getChangesDecodesGardenUpsert() async throws {
        let identifier = "get-changes-garden"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"items":[{"sequence":10,"gardenId":"garden-1","recordId":"garden-1","recordType":"garden",
             "operation":"upsert","recordRevision":4,"committedAt":"2026-01-01T00:00:00.000Z",
             "record":{"recordType":"garden","data":{"id":"garden-1","name":"Backyard","lifecycleState":"active",
             "callerRole":"owner","revision":4,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-02T00:00:00.000Z"}}}],
             "nextCursor":"cursor-1"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let page = try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 100)

        let change = try #require(page.items.first)
        #expect(change.sequence == 10)
        #expect(change.gardenId == "garden-1")
        #expect(change.operation == .upsert)
        #expect(change.recordRevision == 4)
        guard case let .garden(garden) = try #require(change.snapshot) else {
            Issue.record("Expected .garden snapshot")
            return
        }
        #expect(garden.id == "garden-1")
        #expect(garden.name == "Backyard")
        #expect(garden.revision == 4)
    }

    @Test("getChanges decodes an upsert gardenObject change into a typed GardenMapObject snapshot")
    func getChangesDecodesGardenObjectUpsert() async throws {
        let identifier = "get-changes-garden-object"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"items":[{"sequence":11,"gardenId":"garden-1","recordId":"obj-tree","recordType":"gardenObject",
             "operation":"upsert","recordRevision":1,"committedAt":"2026-01-01T00:00:00.000Z",
             "record":{"recordType":"gardenObject","data":{"id":"obj-tree","gardenId":"garden-1","category":"tree",
             "geometryEnvelope":{"geometry":{"type":"Point","coordinates":[4,4]},"coordinateSpaceId":"space-1",
             "coordinateSpaceKind":"localPlanarMetres","provenance":"manualDrawing"},"lifecycleState":"active",
             "revision":1,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}}],
             "nextCursor":"cursor-1"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let page = try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 100)

        guard case let .gardenObject(object) = try #require(page.items.first?.snapshot) else {
            Issue.record("Expected .gardenObject snapshot")
            return
        }
        #expect(object.id == "obj-tree")
        #expect(object.gardenId == "garden-1")
    }

    @Test("getChanges decodes an upsert plant change into a typed Plant snapshot")
    func getChangesDecodesPlantUpsert() async throws {
        let identifier = "get-changes-plant"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"items":[{"sequence":12,"gardenId":"garden-1","recordId":"plant-1","recordType":"plant",
             "operation":"upsert","recordRevision":2,"committedAt":"2026-01-01T00:00:00.000Z",
             "record":{"recordType":"plant","data":{"id":"plant-1","gardenId":"garden-1","displayName":"Tomato",
             "groupingKind":"individual","lifecycleStage":"seedling","status":"active","revision":2,
             "createdByProfileId":"profile-1","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}}],
             "nextCursor":"cursor-1"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let page = try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 100)

        guard case let .plant(plant) = try #require(page.items.first?.snapshot) else {
            Issue.record("Expected .plant snapshot")
            return
        }
        #expect(plant.id == "plant-1")
        #expect(plant.displayName == "Tomato")
    }

    @Test("getChanges decodes an upsert task change into a typed GardenTask snapshot")
    func getChangesDecodesTaskUpsert() async throws {
        let identifier = "get-changes-task"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"items":[{"sequence":13,"gardenId":"garden-1","recordId":"task-1","recordType":"task",
             "operation":"upsert","recordRevision":1,"committedAt":"2026-01-01T00:00:00.000Z",
             "record":{"recordType":"task","data":{"id":"task-1","gardenId":"garden-1","targetKind":"garden",
             "title":"Water the tomatoes","status":"planned","urgency":"normal","source":"manual","revision":1,
             "createdByProfileId":"profile-1","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}}],
             "nextCursor":"cursor-1"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let page = try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 100)

        guard case let .task(task) = try #require(page.items.first?.snapshot) else {
            Issue.record("Expected .task snapshot")
            return
        }
        #expect(task.id == "task-1")
        #expect(task.title == "Water the tomatoes")
    }

    @Test("getChanges decodes a delete change with no snapshot")
    func getChangesDecodesDelete() async throws {
        let identifier = "get-changes-delete"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"items":[{"sequence":14,"gardenId":"garden-1","recordId":"obj-tree","recordType":"gardenObject",
             "operation":"delete","recordRevision":2,"committedAt":"2026-01-01T00:00:00.000Z"}],"nextCursor":"cursor-1"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let page = try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 100)

        let change = try #require(page.items.first)
        #expect(change.operation == .delete)
        #expect(change.snapshot == nil)
    }

    @Test("getChanges decodes a record type with no typed local projection as unprojected, without failing")
    func getChangesDecodesUnprojectedRecordType() async throws {
        let identifier = "get-changes-calibration"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"items":[{"sequence":15,"gardenId":"garden-1","recordId":"calib-1","recordType":"calibration",
             "operation":"upsert","recordRevision":1,"committedAt":"2026-01-01T00:00:00.000Z",
             "record":{"recordType":"calibration","data":{"id":"calib-1"}}}],"nextCursor":"cursor-1"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let page = try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 100)

        guard case let .unprojected(recordType) = try #require(page.items.first?.snapshot) else {
            Issue.record("Expected .unprojected snapshot")
            return
        }
        #expect(recordType == "calibration")
    }

    @Test("getChanges surfaces a 409 cursor_expired as a service error with that exact code")
    func getChangesSurfacesCursorExpired() async throws {
        let identifier = "get-changes-cursor-expired"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"error":{"code":"sync.changes.cursor_expired","message":"Cursor too old.",
             "correlationId":"abc-123","retryable":false}}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(409, responseJSON))

        let failure = await #expect(throws: APIGatewayError.self) {
            try await gateway.getChanges(protocolVersion: 1, after: "stale-cursor", limit: 100)
        }

        guard case let .service(body, statusCode, _) = failure else {
            Issue.record("Expected a service error, received \(String(describing: failure)).")
            return
        }
        #expect(statusCode == 409)
        #expect(body.code == SyncErrorCode.cursorExpired.rawValue)
    }

    @Test("getChanges surfaces the Retry-After header on a 429 as APIGatewayError.retryAfterSeconds")
    func getChangesSurfacesRetryAfterHeader() async throws {
        let identifier = "get-changes-rate-limited"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"error":{"code":"quota.rate_limited","message":"Slow down.",
             "correlationId":"abc-123","retryable":true}}
            """#
        StubURLProtocol.register(
            .json(429, responseJSON, headers: ["Retry-After": "42"]),
            forSession: identifier
        )
        let gateway = URLSessionSyncGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )

        let failure = await #expect(throws: APIGatewayError.self) {
            try await gateway.getChanges(protocolVersion: 1, after: nil, limit: 100)
        }

        #expect(failure?.retryAfterSeconds == 42)
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
