import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the plant gateway's wire shape directly against
/// `packages/api-contracts/openapi.yaml` — this app hand-writes its own
/// networking rather than consuming a generated client, so nothing else
/// checks that this gateway actually speaks the contract. Special attention
/// to `updatePlantDetails`'s use of `FieldUpdate`, since an omit-vs-null bug
/// there would silently corrupt a user's edit.
@Suite("Plant gateway")
struct PlantGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionPlantGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionPlantGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let plantJSON = #"""
        {
          "id": "plant-1",
          "gardenId": "garden-1",
          "gardenAreaMapObjectId": null,
          "placementMapObjectId": null,
          "displayName": "Tomato",
          "taxonomyReferenceId": null,
          "varietyLabel": null,
          "acceptedIdentificationId": null,
          "acquisitionDate": null,
          "acquisitionDateType": null,
          "groupingKind": "individual",
          "quantity": null,
          "lifecycleStage": "seedling",
          "status": "active",
          "conditionNote": null,
          "careGuidanceNote": null,
          "revision": 1,
          "createdByProfileId": "profile-1",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
        """#

    @Test("addPlant posts to the plants collection and decodes the created plant")
    func addPlantDecodesResult() async throws {
        let identifier = "add-plant"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(201, Self.plantJSON))

        let plant = try await gateway.addPlant(
            gardenId: "garden-1",
            displayName: "Tomato",
            taxonomyReferenceId: nil,
            varietyLabel: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: .individual,
            quantity: nil,
            gardenAreaMapObjectId: nil,
            placementMapObjectId: nil,
            idempotencyKey: "idem-1"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/plants")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: APIConfiguration.idempotencyKeyHeader) == "idem-1")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["displayName"] as? String == "Tomato")
        #expect(body["groupingKind"] as? String == "individual")
        // Omitted optionals must not appear at all — a create request that
        // sends `"quantity": null` for an individual plant would still
        // satisfy `quantity: oneOf[int, null]`, but sending nothing is what
        // "not applicable" should look like on the wire.
        #expect(body["quantity"] == nil)
        #expect(body["taxonomyReferenceId"] == nil)

        #expect(plant.id == "plant-1")
        #expect(plant.groupingKind == .individual)
        #expect(plant.lifecycleStage == .seedling)
    }

    @Test("updatePlantDetails sends If-Match and omits unchanged fields")
    func updatePlantDetailsOmitsUnchanged() async throws {
        let identifier = "update-plant-unchanged"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.plantJSON))

        _ = try await gateway.updatePlantDetails(
            gardenId: "garden-1",
            plantId: "plant-1",
            displayName: nil,
            taxonomyReferenceId: .unchanged,
            varietyLabel: .unchanged,
            acquisitionDate: .unchanged,
            acquisitionDateType: .unchanged,
            conditionNote: .unchanged,
            careGuidanceNote: .unchanged,
            quantity: .unchanged,
            expectedRevision: 4,
            idempotencyKey: "idem-2"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/plants/plant-1")
        #expect(request.httpMethod == "PATCH")
        #expect(request.value(forHTTPHeaderField: APIConfiguration.ifMatchHeader) == "\"4\"")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body.isEmpty)
    }

    @Test("updatePlantDetails encodes .set(nil) as an explicit null, distinct from omission")
    func updatePlantDetailsEncodesExplicitNull() async throws {
        let identifier = "update-plant-clear"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.plantJSON))

        _ = try await gateway.updatePlantDetails(
            gardenId: "garden-1",
            plantId: "plant-1",
            displayName: "New name",
            taxonomyReferenceId: .set(nil),
            varietyLabel: .set("Roma"),
            acquisitionDate: .unchanged,
            acquisitionDateType: .unchanged,
            conditionNote: .unchanged,
            careGuidanceNote: .unchanged,
            quantity: .set(3),
            expectedRevision: 4,
            idempotencyKey: "idem-3"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)

        #expect(body["displayName"] as? String == "New name")
        #expect(body["taxonomyReferenceId"] is NSNull)
        #expect(body["varietyLabel"] as? String == "Roma")
        #expect(body["quantity"] as? Int == 3)
        #expect(body["acquisitionDate"] == nil)
        #expect(body["conditionNote"] == nil)
    }

    @Test("transitionLifecycleStage posts the stage and If-Match")
    func transitionLifecycleStagePostsStage() async throws {
        let identifier = "transition-stage"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.plantJSON))

        _ = try await gateway.transitionLifecycleStage(
            gardenId: "garden-1",
            plantId: "plant-1",
            stage: .flowering,
            expectedRevision: 2,
            idempotencyKey: "idem-4"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/plants/plant-1/lifecycle-stage")
        #expect(request.value(forHTTPHeaderField: APIConfiguration.ifMatchHeader) == "\"2\"")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["stage"] as? String == "flowering")
    }

    @Test("setStatus posts the status — also how delete works, never a DELETE request")
    func setStatusPostsStatus() async throws {
        let identifier = "set-status"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.plantJSON))

        _ = try await gateway.setStatus(
            gardenId: "garden-1",
            plantId: "plant-1",
            status: .removed,
            expectedRevision: 2,
            idempotencyKey: "idem-5"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/plants/plant-1/status")
        #expect(request.httpMethod == "POST")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["status"] as? String == "removed")
    }

    @Test("movePlant omits a field left nil, since MovePlantRequest has no null-clearing form")
    func movePlantOmitsNilField() async throws {
        let identifier = "move-plant"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.plantJSON))

        _ = try await gateway.movePlant(
            gardenId: "garden-1",
            plantId: "plant-1",
            gardenAreaMapObjectId: "area-1",
            placementMapObjectId: nil,
            expectedRevision: 3,
            idempotencyKey: "idem-6"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/plants/plant-1/move")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["gardenAreaMapObjectId"] as? String == "area-1")
        #expect(body["placementMapObjectId"] == nil)
    }

    @Test("searchTaxonomyReferences builds query and limit parameters and decodes results")
    func searchTaxonomyReferencesBuildsQuery() async throws {
        let identifier = "search-taxonomy"
        defer { StubURLProtocol.unregister(identifier) }

        let resultJSON = #"""
            {"items": [
              {"id": "tax-1", "scientificName": "Solanum lycopersicum", "commonName": "Tomato", "varietyName": null, "source": "system_catalog", "createdByProfileId": null, "createdAt": "2026-01-01T00:00:00.000Z"}
            ]}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, resultJSON))

        let results = try await gateway.searchTaxonomyReferences(gardenId: "garden-1", query: "tomato", limit: 10)

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/taxonomy-references")
        #expect(request.url?.query?.contains("query=tomato") == true)
        #expect(request.url?.query?.contains("limit=10") == true)

        #expect(results.count == 1)
        #expect(results.first?.commonName == "Tomato")
        #expect(results.first?.source == .systemCatalog)
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
