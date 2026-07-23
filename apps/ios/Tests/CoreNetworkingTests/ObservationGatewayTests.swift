import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the observation gateway's wire shape directly against
/// `packages/api-contracts/openapi.yaml` — this app hand-writes its own
/// networking rather than consuming a generated client.
@Suite("Observation gateway")
struct ObservationGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionObservationGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionObservationGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let observationJSON = #"""
        {
          "id": "obs-1",
          "gardenId": "garden-1",
          "plantId": "plant-1",
          "gardenObjectId": null,
          "actorType": "user",
          "createdByProfileId": "profile-1",
          "noteText": "Looking healthy",
          "conditionSummary": null,
          "correctionKind": null,
          "correctsObservationId": null,
          "isCorrected": false,
          "observedAt": "2026-01-01T00:00:00.000Z",
          "recordedAt": "2026-01-01T00:00:00.000Z",
          "photos": []
        }
        """#

    @Test("recordObservation posts to the garden's observations and decodes the result")
    func recordObservationDecodesResult() async throws {
        let identifier = "record-observation"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(201, Self.observationJSON))

        let observation = try await gateway.recordObservation(
            gardenId: "garden-1",
            plantId: "plant-1",
            gardenObjectId: nil,
            noteText: "Looking healthy",
            conditionSummary: nil,
            observedAt: nil,
            photoMediaIds: [],
            idempotencyKey: "idem-1"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/observations")
        #expect(request.httpMethod == "POST")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["noteText"] as? String == "Looking healthy")
        #expect(body["photoMediaIds"] as? [String] == [])
        #expect(body["observedAt"] == nil)

        #expect(observation.id == "obs-1")
        #expect(observation.isCorrected == false)
    }

    @Test("recordObservation encodes observedAt as an RFC 3339 string, not an epoch number")
    func recordObservationEncodesObservedAtAsString() async throws {
        let identifier = "record-observation-date"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(201, Self.observationJSON))

        _ = try await gateway.recordObservation(
            gardenId: "garden-1",
            plantId: nil,
            gardenObjectId: nil,
            noteText: "Note",
            conditionSummary: nil,
            observedAt: Date(timeIntervalSince1970: 0),
            photoMediaIds: [],
            idempotencyKey: "idem-2"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)

        #expect(body["observedAt"] as? String == "1970-01-01T00:00:00.000Z")
    }

    @Test("listObservationsForGarden requests the garden-wide history")
    func listObservationsForGardenRequestsGardenPath() async throws {
        let identifier = "list-garden"
        defer { StubURLProtocol.unregister(identifier) }

        let listJSON = #"{"items": [\#(Self.observationJSON)]}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, listJSON))

        let observations = try await gateway.listObservationsForGarden(gardenId: "garden-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/observations")
        #expect(request.httpMethod == "GET")
        #expect(observations.count == 1)
    }

    @Test("listObservationsForPlant requests the plant-scoped history")
    func listObservationsForPlantRequestsPlantPath() async throws {
        let identifier = "list-plant"
        defer { StubURLProtocol.unregister(identifier) }

        let listJSON = #"{"items": [\#(Self.observationJSON)]}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, listJSON))

        _ = try await gateway.listObservationsForPlant(gardenId: "garden-1", plantId: "plant-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/plants/plant-1/observations")
    }

    @Test("correctObservation posts to the corrections sub-resource with no gardenId in the path")
    func correctObservationPostsToCorrectionsPath() async throws {
        let identifier = "correct-observation"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(201, Self.observationJSON))

        _ = try await gateway.correctObservation(
            observationId: "obs-original",
            correctionKind: .supersede,
            noteText: "Actually it was pest damage",
            conditionSummary: nil,
            photoMediaIds: [],
            idempotencyKey: "idem-3"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/observations/obs-original/corrections")
        #expect(request.httpMethod == "POST")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["correctionKind"] as? String == "supersede")
        #expect(body["noteText"] as? String == "Actually it was pest damage")
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
