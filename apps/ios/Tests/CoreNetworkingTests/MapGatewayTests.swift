import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the map gateway's wire shape directly against
/// `packages/api-contracts/openapi.yaml` — this app hand-writes its own
/// networking rather than consuming a generated client, so nothing else
/// checks that this gateway actually speaks the contract.
@Suite("Map gateway")
struct MapGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionMapGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionMapGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelationIdentifierProvider(value: identifier),
            authTokenProvider: FakeAuthTokenProvider(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let documentJSON = #"""
        {
          "coordinateSpaceId": "space-1",
          "georeference": {
            "localAnchor": [0, 0],
            "geographicAnchor": [-122.4, 37.7],
            "rotationDegrees": 12.5,
            "scaleCorrection": 1.0,
            "accuracyMetres": 2.5,
            "provenance": "userMeasurement",
            "method": "manual-pin",
            "revision": 1
          },
          "objects": [
            {
              "id": "obj-lot",
              "gardenId": "garden-1",
              "category": "lot",
              "geometryEnvelope": {
                "geometry": {"type": "Polygon", "coordinates": [[[0,0],[10,0],[10,10],[0,10],[0,0]]]},
                "coordinateSpaceId": "space-1",
                "coordinateSpaceKind": "localPlanarMetres",
                "provenance": "manualDrawing"
              },
              "label": "Backyard",
              "lifecycleState": "active",
              "revision": 3,
              "createdAt": "2026-01-01T00:00:00.000Z",
              "updatedAt": "2026-01-02T00:00:00.000Z"
            },
            {
              "id": "obj-tree",
              "gardenId": "garden-1",
              "category": "tree",
              "geometryEnvelope": {
                "geometry": {"type": "Point", "coordinates": [4, 4]},
                "coordinateSpaceId": "space-1",
                "coordinateSpaceKind": "localPlanarMetres",
                "provenance": "manualDrawing"
              },
              "details": {"category": "tree", "commonName": "Oak", "estimatedHeightMetres": 6},
              "lifecycleState": "active",
              "revision": 1,
              "createdAt": "2026-01-01T00:00:00.000Z",
              "updatedAt": "2026-01-01T00:00:00.000Z"
            }
          ],
          "validationSummary": [
            {"code": "geometry.polygon.below_minimum_area", "severity": "warning", "affectedObjectIds": ["obj-lot"]}
          ]
        }
        """#

    @Test("getMap requests the versioned map path and decodes the full document")
    func getMapDecodesDocument() async throws {
        let identifier = "get-map"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.documentJSON))
        let document = try await gateway.getMap(gardenId: "garden-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/map")
        #expect(request.httpMethod == "GET")

        #expect(document.coordinateSpaceId == "space-1")
        #expect(document.georeference?.geographicAnchor == Position(x: -122.4, y: 37.7))
        #expect(document.objects.count == 2)
        #expect(document.validationSummary.first?.code == "geometry.polygon.below_minimum_area")
        #expect(document.validationSummary.first?.severity == .warning)

        let lot = try #require(document.objects.first { $0.id == "obj-lot" })
        #expect(lot.category == .lot)
        #expect(lot.revision == 3)
        #expect(lot.label == "Backyard")
        #expect(lot.geometry == .polygon([[
            Position(x: 0, y: 0), Position(x: 10, y: 0), Position(x: 10, y: 10), Position(x: 0, y: 10),
            Position(x: 0, y: 0),
        ]]))

        let tree = try #require(document.objects.first { $0.id == "obj-tree" })
        guard case let .tree(details)? = tree.categoryDetails else {
            Issue.record("Expected tree details")
            return
        }
        #expect(details.commonName == "Oak")
        #expect(details.estimatedHeightMetres == 6)
    }

    @Test("submitCommand posts a flat body with commandId, clientTimestamp, and payload only")
    func submitCommandBuildsRequestBody() async throws {
        let identifier = "submit-command"
        defer { StubURLProtocol.unregister(identifier) }

        let resultJSON = #"""
            {"affectedObjects": []}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, resultJSON))

        let command = MapCommandPayload.moveObject(
            MoveObjectPayload(objectId: "obj-1", expectedRevision: 4, translationMetres: PlanarOffset(dx: 1, dy: -2))
        )

        _ = try await gateway.submitCommand(gardenId: "garden-1", command: command, idempotencyKey: "idem-key-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/map/commands")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: APIConfiguration.idempotencyKeyHeader) == "idem-key-1")

        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)

        #expect(body["gardenId"] == nil)
        #expect(body["actorProfileId"] == nil)
        #expect(body["actorType"] == nil)
        #expect(body["commandId"] != nil)
        #expect(body["clientTimestamp"] != nil)

        let payload = try #require(body["payload"] as? [String: Any])
        #expect(payload["type"] as? String == "moveObject")
        #expect(payload["objectId"] as? String == "obj-1")
        #expect(payload["expectedRevision"] as? Int == 4)
    }

    @Test("submitCommand flattens categoryDetails to the wire shape, not CoreDomain's nested domain shape")
    func submitCommandFlattensCategoryDetails() async throws {
        let identifier = "submit-command-details"
        defer { StubURLProtocol.unregister(identifier) }

        let resultJSON = #"""
            {"affectedObjects": []}
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, resultJSON))

        let command = MapCommandPayload.createObject(
            CreateObjectPayload(
                objectId: "obj-1",
                category: .structure,
                geometry: .point(Position(x: 0, y: 0)),
                categoryDetails: .structure(StructureDetails(structureKind: .shed, heightMetres: 2.5))
            )
        )

        _ = try await gateway.submitCommand(
            gardenId: "garden-1", command: command, idempotencyKey: "idem-key-2"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        let payload = try #require(body["payload"] as? [String: Any])
        let categoryDetails = try #require(payload["categoryDetails"] as? [String: Any])

        // Flat: category alongside structureKind/heightMetres, no nested
        // "details" key — the shape a real request parser requires.
        #expect(categoryDetails["category"] as? String == "structure")
        #expect(categoryDetails["structureKind"] as? String == "shed")
        #expect(categoryDetails["heightMetres"] as? Double == 2.5)
        #expect(categoryDetails["details"] == nil)
    }

    @Test("submitCommand decodes affected objects at their new revision")
    func submitCommandDecodesResult() async throws {
        let identifier = "submit-result"
        defer { StubURLProtocol.unregister(identifier) }

        let resultJSON = #"""
            {
              "affectedObjects": [
                {
                  "id": "obj-1",
                  "gardenId": "garden-1",
                  "category": "fence",
                  "geometryEnvelope": {
                    "geometry": {"type": "LineString", "coordinates": [[0,0],[5,0]]},
                    "coordinateSpaceId": "space-1",
                    "coordinateSpaceKind": "localPlanarMetres",
                    "provenance": "manualDrawing"
                  },
                  "details": {"category": "fence", "fenceKind": "wood"},
                  "lifecycleState": "active",
                  "revision": 5,
                  "createdAt": "2026-01-01T00:00:00.000Z",
                  "updatedAt": "2026-01-03T00:00:00.000Z"
                }
              ]
            }
            """#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, resultJSON))

        let result = try await gateway.submitCommand(
            gardenId: "garden-1",
            command: .deleteObject(DeleteObjectPayload(objectId: "obj-1", expectedRevision: 4)),
            idempotencyKey: "idem-key-2"
        )

        #expect(result.affectedObjects.count == 1)
        #expect(result.affectedObjects.first?.revision == 5)
        guard case let .fence(details)? = result.affectedObjects.first?.categoryDetails else {
            Issue.record("Expected fence details")
            return
        }
        #expect(details.fenceKind == .wood)
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
    /// Test convenience: `URLProtocol` stubbing captures the request before
    /// `httpBody` is populated on some transports, so this checks both the
    /// stream and the plain body, whichever `StubURLProtocol` observed.
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
