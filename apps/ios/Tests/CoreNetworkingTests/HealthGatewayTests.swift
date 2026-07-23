import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

@Suite("Health gateway")
struct HealthGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(
        identifier: String,
        answer: StubURLProtocol.Answer
    ) -> URLSessionHealthGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionHealthGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier)
        )
    }

    @Test("Liveness maps onto the domain type")
    func decodesLiveness() async throws {
        let identifier = "liveness"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, #"{"status":"alive","version":"1.4.0"}"#)
        )

        #expect(try await gateway.liveness() == ServiceLiveness(version: "1.4.0"))
    }

    @Test("Readiness requests the versioned path and declares its correlation id")
    func buildsRequest() async throws {
        let identifier = "request-shape"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(200, #"{"status":"ready","version":"1.4.0","dependencies":[]}"#)
        )

        _ = try await gateway.readiness()
        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)

        #expect(request.url?.path == "/v1/health/ready")
        #expect(request.httpMethod == "GET")
        #expect(
            request.value(forHTTPHeaderField: APIConfiguration.correlationIdHeader) == identifier
        )
    }

    /// An unready service answers 503 with the same body. Treating that as a
    /// thrown error would hide the dependency detail the user is shown.
    @Test("A 503 readiness response is a value, not a failure")
    func decodesUnreadyService() async throws {
        let identifier = "not-ready"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(
                503,
                """
                {"status":"notReady","version":"1.4.0","dependencies":[
                  {"name":"database","status":"unavailable","detail":"connection refused"}
                ]}
                """
            )
        )

        let health = try await gateway.readiness()

        #expect(!health.isReady)
        #expect(health.unavailableDependencies.map(\.name) == ["database"])
    }

    @Test("A contract error envelope becomes a typed service error")
    func mapsErrorEnvelope() async throws {
        let identifier = "envelope"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .json(
                500,
                """
                {"error":{"code":"server.internal","message":"Unexpected failure.",
                "correlationId":"abc-123","retryable":true}}
                """
            )
        )

        let failure = await #expect(throws: APIGatewayError.self) {
            try await gateway.readiness()
        }

        guard case let .service(body, statusCode, _) = failure else {
            Issue.record("Expected a service error, received \(String(describing: failure)).")
            return
        }

        #expect(statusCode == 500)
        #expect(body.sharedCode == .internalFailure)
        #expect(body.correlationId == "abc-123")
        #expect(failure?.isRetryable == true)
    }

    @Test("A rejected status without an envelope is reported as unexpected")
    func mapsUnexpectedStatus() async throws {
        let identifier = "no-envelope"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(502, "<html/>"))

        let failure = await #expect(throws: APIGatewayError.self) {
            try await gateway.readiness()
        }

        #expect(failure == .unexpectedStatus(502, correlationId: identifier))
        #expect(failure?.isRetryable == false)
    }

    @Test("A success body that violates the contract is a contract failure")
    func mapsUndecodableSuccess() async throws {
        let identifier = "undecodable"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, #"{"status":"ready"}"#))

        let failure = await #expect(throws: APIGatewayError.self) {
            try await gateway.readiness()
        }

        #expect(failure == .undecodableResponse(statusCode: 200, correlationId: identifier))
    }

    @Test("A connectivity failure keeps the correlation identifier and stays retryable")
    func mapsTransportFailure() async throws {
        let identifier = "offline"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(
            identifier: identifier,
            answer: .transportFailure(.notConnectedToInternet)
        )

        let failure = await #expect(throws: APIGatewayError.self) {
            try await gateway.readiness()
        }

        #expect(
            failure == .transport(code: .notConnectedToInternet, correlationId: identifier)
        )
        #expect(failure?.isRetryable == true)
    }
}

/// Deterministic correlation identifiers, so a test can assert the header.
private struct FixedCorrelationIdentifierProvider: CorrelationIdentifierProvider {
    let value: String

    func next() -> CorrelationIdentifier {
        CorrelationIdentifier(value: value)
    }
}
