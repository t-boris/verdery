import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the recommendation gateway's wire shape directly against
/// `packages/api-contracts/openapi.yaml`, tag `Recommendations` (P7-IOS-01):
/// the Today query with its flat item schema (priority factors, structured
/// evidence, open-shaped JSON facts, nullable members), and the five
/// commands' paths, methods, `If-Match`/`Idempotency-Key` headers, and
/// bodies. This app hand-writes its own networking, so nothing else checks
/// that this gateway actually speaks the contract.
@Suite("Recommendation gateway")
struct RecommendationGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private struct FixedCorrelation: CorrelationIdentifierProvider {
        let value: String
        func next() -> CorrelationIdentifier { CorrelationIdentifier(value: value) }
    }

    private struct FixedAuthToken: AuthTokenProvider {
        let token: String?
        func currentIdToken() async throws -> String? { token }
    }

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionRecommendationGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionRecommendationGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelation(value: identifier),
            authTokenProvider: FixedAuthToken(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    /// The command-response `Recommendation` schema — the state a `complete`
    /// produced.
    private static let completedRecommendationJSON = #"""
        {
          "id": "rec-1",
          "gardenId": "garden-1",
          "ruleKey": "watering.deep-soak",
          "ruleVersion": 2,
          "careCategory": "watering",
          "safetyTier": "ordinary_care",
          "state": "completed",
          "urgency": "high",
          "targetKind": "plant",
          "targetGardenAreaMapObjectId": null,
          "targetPlantId": "plant-1",
          "windowStart": "2026-07-20T06:00:00.000Z",
          "windowEnd": "2026-07-22T18:00:00.000Z",
          "explanation": "Six dry days in a heat spell.",
          "supersedesCandidateId": null,
          "presentedAt": "2026-07-20T08:00:00.000Z",
          "revision": 4,
          "createdAt": "2026-07-20T05:00:00.000Z",
          "updatedAt": "2026-07-20T09:00:00.000Z"
        }
        """#

    /// The contract's FLAT `TodayRecommendation` schema: every
    /// `Recommendation` field plus the view-only members.
    private static let todayItemJSON = #"""
        {
          "id": "rec-1",
          "gardenId": "garden-1",
          "ruleKey": "watering.deep-soak",
          "ruleVersion": 2,
          "careCategory": "watering",
          "safetyTier": "elevated_risk",
          "state": "presented",
          "urgency": "high",
          "targetKind": "plant",
          "targetGardenAreaMapObjectId": null,
          "targetPlantId": "plant-1",
          "windowStart": null,
          "windowEnd": "2026-07-22T18:00:00.000Z",
          "explanation": "Six dry days in a heat spell.",
          "supersedesCandidateId": "rec-0",
          "presentedAt": null,
          "revision": 2,
          "createdAt": "2026-07-20T05:00:00.000Z",
          "updatedAt": "2026-07-20T05:00:00.000Z",
          "actionTitle": "Deep-soak the tomato bed",
          "priorityScore": 72,
          "priorityFactors": [
            {"kind": "urgency_window", "contribution": 40, "basis": {"windowEndsInHours": 58}},
            {"kind": "confidence", "contribution": -8, "basis": {"identityConfidence": 0.62, "weatherFreshness": "stale"}}
          ],
          "evidence": [
            {
              "id": "ev-1",
              "kind": "weather",
              "sourceObservationId": null,
              "sourceTaskId": null,
              "sourcePlantId": null,
              "sourceWeatherRecordId": "weather-1",
              "factKey": "forecastAgeHours",
              "factValue": 26
            },
            {
              "id": "ev-2",
              "kind": "plant_identity",
              "sourceObservationId": null,
              "sourceTaskId": null,
              "sourcePlantId": "plant-1",
              "sourceWeatherRecordId": null,
              "factKey": "displayName",
              "factValue": null
            }
          ],
          "targetDisplayName": "Tomato 'Roma'"
        }
        """#

    @Test("getTodayRecommendations requests the today path with the limit cap and decodes the flat item")
    func todayBuildsPathAndDecodes() async throws {
        let identifier = "recommendations-today"
        defer { StubURLProtocol.unregister(identifier) }

        let body = #"{"gardenId": "garden-1", "generatedAt": "2026-07-20T08:00:00.000Z", "items": [\#(Self.todayItemJSON)]}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, body))

        let result = try await gateway.getTodayRecommendations(gardenId: "garden-1", limit: 5)

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/today")
        #expect(request.url?.query == "limit=5")
        #expect(request.httpMethod == "GET")
        // The first-presentation mark rides the read server-side; the GET
        // itself carries no idempotency key — the contract's own design.
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == nil)

        #expect(result.gardenId == "garden-1")
        let item = try #require(result.items.first)
        #expect(item.recommendation.ruleKey == "watering.deep-soak")
        #expect(item.recommendation.ruleVersion == 2)
        #expect(item.recommendation.safetyTier == .elevatedRisk)
        #expect(item.recommendation.state == .presented)
        #expect(item.recommendation.urgency == .high)
        #expect(item.recommendation.windowStart == nil)
        #expect(item.recommendation.windowEnd != nil)
        #expect(item.recommendation.supersedesCandidateId == "rec-0")
        #expect(item.recommendation.revision == 2)
        #expect(item.actionTitle == "Deep-soak the tomato bed")
        #expect(item.priorityScore == 72)
        #expect(item.targetDisplayName == "Tomato 'Roma'")

        #expect(item.priorityFactors.map(\.kind) == [.urgencyWindow, .confidence])
        let confidence = try #require(item.priorityFactors.last)
        #expect(confidence.contribution == -8)
        #expect(confidence.basis["weatherFreshness"] == .string("stale"))
        #expect(confidence.basis["identityConfidence"] == .number(0.62))

        #expect(item.evidence.map(\.kind) == [.weather, .plantIdentity])
        #expect(item.evidence.first?.sourceWeatherRecordId == "weather-1")
        #expect(item.evidence.first?.factValue == .number(26))
        // `null` factValue: the referenced row itself is the value.
        #expect(item.evidence.last?.factValue == JSONValue.null)
    }

    @Test("getTodayRecommendations omits the limit parameter when none is given")
    func todayOmitsAbsentLimit() async throws {
        let identifier = "recommendations-today-no-limit"
        defer { StubURLProtocol.unregister(identifier) }

        let body = #"{"gardenId": "garden-1", "generatedAt": "2026-07-20T08:00:00.000Z", "items": []}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, body))

        let result = try await gateway.getTodayRecommendations(gardenId: "garden-1", limit: nil)

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.query == nil)
        #expect(result.items.isEmpty)
    }

    @Test("completeRecommendation posts with If-Match and Idempotency-Key")
    func completeSendsRevisionHeaders() async throws {
        let identifier = "recommendations-complete"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.completedRecommendationJSON))

        let result = try await gateway.completeRecommendation(
            gardenId: "garden-1",
            recommendationId: "rec-1",
            expectedRevision: 3,
            idempotencyKey: "key-1"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/recommendations/rec-1/complete")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "If-Match") == "\"3\"")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "key-1")

        #expect(result.state == .completed)
        #expect(result.revision == 4)
    }

    @Test("postponeRecommendation carries the user's horizon in the request body")
    func postponeSendsHorizon() async throws {
        let identifier = "recommendations-postpone"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.completedRecommendationJSON))

        _ = try await gateway.postponeRecommendation(
            gardenId: "garden-1",
            recommendationId: "rec-1",
            postponedUntil: Date(timeIntervalSince1970: 1_785_900_000),
            expectedRevision: 3,
            idempotencyKey: "key-2"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/recommendations/rec-1/postpone")
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        let horizon = try #require(body["postponedUntil"] as? String)
        // The transport's shared RFC 3339 fractional-seconds encoder.
        #expect(horizon.hasSuffix("Z"))
        #expect(horizon.contains("."))
    }

    @Test("postponeRecommendation with no horizon omits the member — absent means no default applied")
    func postponeOmitsAbsentHorizon() async throws {
        let identifier = "recommendations-postpone-no-horizon"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.completedRecommendationJSON))

        _ = try await gateway.postponeRecommendation(
            gardenId: "garden-1",
            recommendationId: "rec-1",
            postponedUntil: nil,
            expectedRevision: 3,
            idempotencyKey: "key-3"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        let body = try #require(request.bodyStreamJSON ?? request.httpBodyJSON)
        #expect(body["postponedUntil"] == nil)
    }

    @Test("dismissRecommendation and markRecommendationIrrelevant post to their own paths", arguments: [
        ("dismiss", "recommendations-dismiss"),
        ("mark-irrelevant", "recommendations-mark-irrelevant"),
    ])
    func feedbackCommandsUseTheirPaths(action: String, identifier: String) async throws {
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.completedRecommendationJSON))

        _ = action == "dismiss"
            ? try await gateway.dismissRecommendation(
                gardenId: "garden-1", recommendationId: "rec-1", expectedRevision: 3, idempotencyKey: "key-4")
            : try await gateway.markRecommendationIrrelevant(
                gardenId: "garden-1", recommendationId: "rec-1", expectedRevision: 3, idempotencyKey: "key-4")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/recommendations/rec-1/\(action)")
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "If-Match") == "\"3\"")
    }

    @Test("convertRecommendationToTask accepts 201 and decodes both halves, including the additive origin field")
    func convertDecodesRecommendationAndTask() async throws {
        let identifier = "recommendations-convert"
        defer { StubURLProtocol.unregister(identifier) }

        // `originRecommendationId` is the contract's additive `Task` member
        // (P7-BE-01); `GardenTaskTransport` does not model it yet (see this
        // stage's found-not-fixed note), so its presence here proves the
        // decode tolerates it rather than breaking.
        let taskJSON = #"""
            {
              "id": "task-9",
              "gardenId": "garden-1",
              "targetKind": "plant",
              "targetGardenAreaMapObjectId": null,
              "targetPlantId": "plant-1",
              "title": "Deep-soak the tomato bed",
              "notes": "Six dry days in a heat spell.",
              "status": "planned",
              "dueDate": null,
              "timeWindowStart": "2026-07-20T06:00:00.000Z",
              "timeWindowEnd": "2026-07-22T18:00:00.000Z",
              "recurrenceRule": null,
              "urgency": "high",
              "source": "suggested",
              "originObservationId": null,
              "originRecommendationId": "rec-1",
              "revision": 1,
              "createdByProfileId": "profile-1",
              "createdAt": "2026-07-20T09:00:00.000Z",
              "updatedAt": "2026-07-20T09:00:00.000Z",
              "completedAt": null
            }
            """#
        let body = #"{"recommendation": \#(Self.completedRecommendationJSON), "task": \#(taskJSON)}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(201, body))

        let result = try await gateway.convertRecommendationToTask(
            gardenId: "garden-1",
            recommendationId: "rec-1",
            expectedRevision: 3,
            idempotencyKey: "key-5"
        )

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/recommendations/rec-1/convert-to-task")
        #expect(request.value(forHTTPHeaderField: "If-Match") == "\"3\"")
        #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "key-5")

        #expect(result.recommendation.state == .completed)
        #expect(result.task.id == "task-9")
        #expect(result.task.source == .suggested)
        #expect(result.task.status == .planned)
        #expect(result.task.title == "Deep-soak the tomato bed")
        #expect(result.task.notes == "Six dry days in a heat spell.")
    }
}

private extension URLRequest {
    var httpBodyJSON: [String: Any]? {
        guard let data = httpBody, let object = try? JSONSerialization.jsonObject(with: data) else { return nil }
        return object as? [String: Any]
    }

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
