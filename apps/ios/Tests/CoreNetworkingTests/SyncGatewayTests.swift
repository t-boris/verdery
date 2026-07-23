import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers `SyncGateway`'s wire shape directly against
/// `packages/api-contracts/openapi.yaml`'s `Synchronization` tag — the same
/// "this app hand-writes its own networking, nothing else checks the
/// contract is actually spoken" rationale `PlantGatewayTests`'s own doc
/// comment gives. Special attention to `push`'s flexible per-outcome
/// decoding (`SyncPushOperationResultTransport.makeDomainOutcome()`), since a
/// bug there would silently misroute a real push result.
@Suite("Sync gateway")
struct SyncGatewayTests {
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

    private func operation(
        id: String = "op-1",
        commandVersion: Int = 1,
        localSequence: Int64 = 4102,
        dependencyOperationIds: [String] = [],
        mediaPrerequisiteIds: [String] = [],
        payload: String = #"{"recordType":"garden","gardenId":"garden-1","command":{"commandType":"gardens.create","request":{"name":"Test"}}}"#
    ) -> OutboxOperation {
        OutboxOperation(
            id: id,
            profileId: "profile-1",
            gardenId: "garden-1",
            commandType: "gardens.create",
            commandVersion: commandVersion,
            targetRecordIds: ["garden-1"],
            expectedRevision: nil,
            payload: payload,
            dependencyOperationIds: dependencyOperationIds,
            mediaPrerequisiteIds: mediaPrerequisiteIds,
            localSequence: localSequence,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    // MARK: - registerClient

    @Test("registerClient PUTs to sync/clients/{id} with platform ios and decodes success")
    func registerClientSendsExpectedRequest() async throws {
        let identifier = "register-client"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"id":"install-1","platform":"ios","appVersion":"1.2.3","protocolVersion":1,
             "registeredAt":"2026-01-01T00:00:00.000Z","lastSeenAt":"2026-01-01T00:00:00.000Z"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(201, responseJSON))

        try await gateway.registerClient(clientInstallationId: "install-1", appVersion: "1.2.3", protocolVersion: 1)

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/sync/clients/install-1")
        #expect(request.httpMethod == "PUT")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["platform"] as? String == "ios")
        #expect(body["appVersion"] as? String == "1.2.3")
        #expect(body["protocolVersion"] as? Int == 1)
    }

    @Test("registerClient accepts both 200 (refresh) and 201 (new)")
    func registerClientAccepts200() async throws {
        let identifier = "register-client-refresh"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"id":"install-1","platform":"ios","appVersion":"1.2.3","protocolVersion":1,
             "registeredAt":"2026-01-01T00:00:00.000Z","lastSeenAt":"2026-01-01T00:00:00.000Z"}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        try await gateway.registerClient(clientInstallationId: "install-1", appVersion: "1.2.3", protocolVersion: 1)
    }

    // MARK: - push request shape

    @Test("push POSTs to sync/push with no Idempotency-Key header, embedding each operation's own payload verbatim")
    func pushSendsExpectedRequest() async throws {
        let identifier = "push-request-shape"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"accepted","operationId":"op-1",
             "recordRevisions":[{"recordId":"garden-1","recordType":"garden","revision":1}]}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        _ = try await gateway.push(
            clientInstallationId: "install-1",
            protocolVersion: 1,
            operationPayloadVersion: 1,
            operations: [operation()]
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/sync/push")
        #expect(request.httpMethod == "POST")
        // Unlike every other mutation this app sends: each operation's own
        // `operationId` is its idempotency key, not a request-level header —
        // architecture/offline-synchronization.md, section "9. Server
        // Idempotency".
        #expect(request.value(forHTTPHeaderField: APIConfiguration.idempotencyKeyHeader) == nil)

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["clientInstallationId"] as? String == "install-1")
        #expect(body["protocolVersion"] as? Int == 1)
        #expect(body["operationPayloadVersion"] as? Int == 1)

        let operations = try #require(body["operations"] as? [[String: Any]])
        let firstOperation = try #require(operations.first)
        #expect(firstOperation["operationId"] as? String == "op-1")
        #expect(firstOperation["commandVersion"] as? Int == 1)
        #expect(firstOperation["localSequence"] as? Int == 4102)

        // The stored `OutboxOperation.payload` JSON string is embedded
        // verbatim, not re-derived — see `SyncOperationTransport.init(_:)`'s
        // own doc comment.
        let payload = try #require(firstOperation["payload"] as? [String: Any])
        #expect(payload["recordType"] as? String == "garden")
        #expect(payload["gardenId"] as? String == "garden-1")
        let command = try #require(payload["command"] as? [String: Any])
        #expect(command["commandType"] as? String == "gardens.create")
    }

    @Test("push includes dependsOnOperationIds and defaults mediaPrerequisites' allowPendingUpload to false")
    func pushIncludesDependenciesAndMediaPrerequisites() async throws {
        let identifier = "push-dependencies"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"accepted","operationId":"op-2",
             "recordRevisions":[{"recordId":"garden-1","recordType":"garden","revision":1}]}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let withDependency = operation(id: "op-2", dependencyOperationIds: ["op-1"], mediaPrerequisiteIds: ["media-1"])

        _ = try await gateway.push(
            clientInstallationId: "install-1",
            protocolVersion: 1,
            operationPayloadVersion: 1,
            operations: [withDependency]
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        let operations = try #require(body["operations"] as? [[String: Any]])
        let firstOperation = try #require(operations.first)

        #expect(firstOperation["dependsOnOperationIds"] as? [String] == ["op-1"])
        let mediaPrerequisites = try #require(firstOperation["mediaPrerequisites"] as? [[String: Any]])
        #expect(mediaPrerequisites.first?["mediaId"] as? String == "media-1")
        #expect(mediaPrerequisites.first?["allowPendingUpload"] as? Bool == false)
    }

    // MARK: - push response decoding, per outcome

    @Test("push decodes an accepted result with its record revisions")
    func pushDecodesAccepted() async throws {
        let identifier = "push-accepted"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"accepted","operationId":"op-1",
             "recordRevisions":[{"recordId":"garden-1","recordType":"garden","revision":3}]}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let outcomes = try await gateway.push(
            clientInstallationId: "install-1", protocolVersion: 1, operationPayloadVersion: 1, operations: [operation()]
        )

        guard case let .accepted(operationId, recordRevisions) = try #require(outcomes.first) else {
            Issue.record("Expected .accepted")
            return
        }
        #expect(operationId == "op-1")
        #expect(recordRevisions == [SyncRecordReference(recordId: "garden-1", recordType: "garden", revision: 3)])
    }

    @Test("push decodes a duplicate result the same shape as accepted")
    func pushDecodesDuplicate() async throws {
        let identifier = "push-duplicate"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"duplicate","operationId":"op-1",
             "recordRevisions":[{"recordId":"garden-1","recordType":"garden","revision":2}]}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let outcomes = try await gateway.push(
            clientInstallationId: "install-1", protocolVersion: 1, operationPayloadVersion: 1, operations: [operation()]
        )

        guard case let .duplicate(_, recordRevisions) = try #require(outcomes.first) else {
            Issue.record("Expected .duplicate")
            return
        }
        #expect(recordRevisions.first?.revision == 2)
    }

    @Test("push decodes a conflict result with the current server representation preserved verbatim")
    func pushDecodesConflict() async throws {
        let identifier = "push-conflict"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"conflict","operationId":"op-1","conflictCode":"staleRevision",
             "currentRecord":{"recordType":"garden","data":{"id":"garden-1","name":"Server Name","revision":5}}}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let outcomes = try await gateway.push(
            clientInstallationId: "install-1", protocolVersion: 1, operationPayloadVersion: 1, operations: [operation()]
        )

        guard case let .conflict(operationId, conflictCode, currentRecordType, currentRecordJSON) = try #require(outcomes.first) else {
            Issue.record("Expected .conflict")
            return
        }
        #expect(operationId == "op-1")
        #expect(conflictCode == "staleRevision")
        #expect(currentRecordType == "garden")
        // Re-serialized, not the original bytes — but every field survives.
        let decoded = try #require(
            (try JSONSerialization.jsonObject(with: Data(currentRecordJSON.utf8))) as? [String: Any]
        )
        #expect(decoded["recordType"] as? String == "garden")
        let data = try #require(decoded["data"] as? [String: Any])
        #expect(data["name"] as? String == "Server Name")
        #expect(data["revision"] as? Int == 5)
    }

    @Test("push decodes a rejected result with its error code and message")
    func pushDecodesRejected() async throws {
        let identifier = "push-rejected"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"rejected","operationId":"op-1",
             "error":{"code":"request.idempotency.key_reused","message":"Payload mismatch."}}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let outcomes = try await gateway.push(
            clientInstallationId: "install-1", protocolVersion: 1, operationPayloadVersion: 1, operations: [operation()]
        )

        guard case let .rejected(_, errorCode, errorMessage) = try #require(outcomes.first) else {
            Issue.record("Expected .rejected")
            return
        }
        #expect(errorCode == "request.idempotency.key_reused")
        #expect(errorMessage == "Payload mismatch.")
    }

    @Test("push decodes a blockedByDependency result with its blocking operation ids")
    func pushDecodesBlockedByDependency() async throws {
        let identifier = "push-blocked"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"blockedByDependency","operationId":"op-1","blockingOperationIds":["op-0"]}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let outcomes = try await gateway.push(
            clientInstallationId: "install-1", protocolVersion: 1, operationPayloadVersion: 1, operations: [operation()]
        )

        guard case let .blockedByDependency(_, blockingOperationIds) = try #require(outcomes.first) else {
            Issue.record("Expected .blockedByDependency")
            return
        }
        #expect(blockingOperationIds == ["op-0"])
    }

    @Test("push decodes a retryLater result with its optional retryAfterSeconds and reason")
    func pushDecodesRetryLater() async throws {
        let identifier = "push-retry-later"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"retryLater","operationId":"op-1",
             "retryAfterSeconds":30,"reason":"server.dependency_unavailable"}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let outcomes = try await gateway.push(
            clientInstallationId: "install-1", protocolVersion: 1, operationPayloadVersion: 1, operations: [operation()]
        )

        guard case let .retryLater(_, retryAfterSeconds, reason) = try #require(outcomes.first) else {
            Issue.record("Expected .retryLater")
            return
        }
        #expect(retryAfterSeconds == 30)
        #expect(reason == "server.dependency_unavailable")
    }

    // MARK: - acknowledge

    @Test("acknowledge POSTs operation ids and decodes unknown for one the server has no stored outcome for")
    func acknowledgeDecodesUnknown() async throws {
        let identifier = "acknowledge-unknown"
        defer { StubURLProtocol.unregister(identifier) }

        let responseJSON = #"""
            {"results":[{"outcome":"unknown","operationId":"op-1"}]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, responseJSON))

        let outcomes = try await gateway.acknowledge(clientInstallationId: "install-1", operationIds: ["op-1"])

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/sync/acknowledge")
        #expect(request.httpMethod == "POST")
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["operationIds"] as? [String] == ["op-1"])

        guard case .unknown(let operationId) = try #require(outcomes.first) else {
            Issue.record("Expected .unknown")
            return
        }
        #expect(operationId == "op-1")
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
