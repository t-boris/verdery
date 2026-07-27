import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the garden context facts gateway's wire shape directly against
/// `packages/api-contracts/openapi.yaml`, tag `GardenContext` (P9D-UX-01):
/// the list read, the `PUT` path/method/body, and — the one deliberate
/// divergence from every other mutation this app sends — that NEITHER
/// `Idempotency-Key` NOR `If-Match` rides on the request. This app
/// hand-writes its own networking, so nothing else checks that this gateway
/// actually speaks the contract.
@Suite("Garden context gateway")
struct GardenContextGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private struct FixedCorrelation: CorrelationIdentifierProvider {
        let value: String
        func next() -> CorrelationIdentifier { CorrelationIdentifier(value: value) }
    }

    private struct FixedAuthToken: AuthTokenProvider {
        let token: String?
        func currentIdToken() async throws -> String? { token }
    }

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionGardenContextGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionGardenContextGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelation(value: identifier),
            authTokenProvider: FixedAuthToken(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let userDeclaredFactJSON = #"""
        {
          "id": "fact-1",
          "gardenId": "garden-1",
          "contextKind": "sun_exposure",
          "value": "full_sun",
          "source": "user_declared",
          "recordedByProfileId": "profile-1",
          "recordedAt": "2026-07-20T05:00:00.000Z",
          "revision": 1,
          "createdAt": "2026-07-20T05:00:00.000Z",
          "updatedAt": "2026-07-20T05:00:00.000Z"
        }
        """#

    private static let reviewedFactJSON = #"""
        {
          "id": "fact-2",
          "gardenId": "garden-1",
          "contextKind": "drainage",
          "value": "well_drained",
          "source": "horticulturally_reviewed_default",
          "reviewedBy": "Dr. Soil",
          "reviewedOn": "2026-01-15",
          "recordedByProfileId": "profile-2",
          "recordedAt": "2026-01-15T05:00:00.000Z",
          "revision": 3,
          "createdAt": "2026-01-01T05:00:00.000Z",
          "updatedAt": "2026-01-15T05:00:00.000Z"
        }
        """#

    @Test("listGardenContextFacts requests the context path and decodes every fact, including reviewedBy/reviewedOn")
    func listDecodesFacts() async throws {
        let identifier = "garden-context-list"
        defer { StubURLProtocol.unregister(identifier) }

        let body = #"{"items": [\#(Self.userDeclaredFactJSON), \#(Self.reviewedFactJSON)]}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, body))

        let result = try await gateway.listGardenContextFacts(gardenId: "garden-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/context")
        #expect(request.httpMethod == "GET")

        #expect(result.items.count == 2)
        let declared = try #require(result.items.first)
        #expect(declared.contextKind == .sunExposure)
        #expect(declared.source == .userDeclared)
        #expect(declared.reviewedBy == nil)
        #expect(declared.reviewedOn == nil)

        let reviewed = try #require(result.items.last)
        #expect(reviewed.contextKind == .drainage)
        #expect(reviewed.source == .horticulturallyReviewedDefault)
        #expect(reviewed.reviewedBy == "Dr. Soil")
        #expect(reviewed.reviewedOn == "2026-01-15")
        #expect(reviewed.recordedByProfileId == "profile-2")
        #expect(reviewed.revision == 3)
    }

    @Test("recordGardenContextFact PUTs to the contextKind path, carries the body, and sends neither Idempotency-Key nor If-Match")
    func recordSendsPutWithNoRevisionHeaders() async throws {
        let identifier = "garden-context-record"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.userDeclaredFactJSON))

        let result = try await gateway.recordGardenContextFact(
            gardenId: "garden-1",
            contextKind: .sunExposure,
            value: "full_sun",
            source: .userDeclared,
            reviewedBy: nil,
            reviewedOn: nil
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/context/sun_exposure")
        #expect(request.httpMethod == "PUT")
        // The endpoint's own contract: "Idempotent BY DESIGN... deliberately
        // takes neither `Idempotency-Key` nor `If-Match`" — a genuine
        // divergence from every other mutation this app sends.
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)
        #expect(request.value(forHTTPHeaderField: "If-Match") == nil)

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["value"] as? String == "full_sun")
        #expect(body["source"] as? String == "user_declared")
        #expect(body["reviewedBy"] == nil)
        #expect(body["reviewedOn"] == nil)

        #expect(result.contextKind == .sunExposure)
        #expect(result.value == "full_sun")
    }

    @Test("recordGardenContextFact includes reviewedBy/reviewedOn only when present")
    func recordIncludesReviewedFieldsWhenPresent() async throws {
        let identifier = "garden-context-record-reviewed"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.reviewedFactJSON))

        _ = try await gateway.recordGardenContextFact(
            gardenId: "garden-1",
            contextKind: .drainage,
            value: "well_drained",
            source: .horticulturallyReviewedDefault,
            reviewedBy: "Dr. Soil",
            reviewedOn: "2026-01-15"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["reviewedBy"] as? String == "Dr. Soil")
        #expect(body["reviewedOn"] as? String == "2026-01-15")
    }
}

private extension URLRequest {
    var httpBodyJSON: [String: Any]? {
        guard let data = httpBody, let object = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return object as? [String: Any]
    }

    /// `URLSession` delivers a mutation's body via `httpBodyStream` rather
    /// than `httpBody` in practice for this transport — the same reason
    /// `RecommendationGatewayTests` reads both.
    var bodyStreamJSON: [String: Any]? {
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
