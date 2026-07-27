import CoreDomain
import CoreObservability
import Foundation
import Testing

@testable import CoreNetworking

/// Covers the seasonal plan gateway's wire shape directly against
/// `packages/api-contracts/openapi.yaml`, tag `SeasonalPlan` (P9D-UX-01):
/// the request path, the `reviewed`/`noSeasonalData` discriminated union,
/// and every nullable timing/rotation field. This app hand-writes its own
/// networking, so nothing else checks that this gateway actually speaks the
/// contract.
@Suite("Seasonal plan gateway")
struct SeasonalPlanGatewayTests {
    private let origin = URL(string: "https://api.example.test")!

    private struct FixedCorrelation: CorrelationIdentifierProvider {
        let value: String
        func next() -> CorrelationIdentifier { CorrelationIdentifier(value: value) }
    }

    private struct FixedAuthToken: AuthTokenProvider {
        let token: String?
        func currentIdToken() async throws -> String? { token }
    }

    private func makeGateway(identifier: String, answer: StubURLProtocol.Answer) -> URLSessionSeasonalPlanGateway {
        StubURLProtocol.register(answer, forSession: identifier)

        return URLSessionSeasonalPlanGateway(
            configuration: APIConfiguration(origin: origin),
            session: StubURLProtocol.makeSession(identifier: identifier),
            correlationIdentifiers: FixedCorrelation(value: identifier),
            authTokenProvider: FixedAuthToken(token: "id-token"),
            log: NoOperationDiagnosticLog()
        )
    }

    private static let resultJSON = #"""
        {
          "gardenId": "garden-1",
          "hemisphere": "northern",
          "plants": [
            {
              "plantId": "plant-1",
              "taxonomyReferenceId": "taxon-1",
              "seasonalFact": {
                "status": "reviewed",
                "timing": {
                  "sowIndoorsStartMonth": 2,
                  "sowIndoorsEndMonth": 3,
                  "sowOutdoorsStartMonth": null,
                  "sowOutdoorsEndMonth": null,
                  "transplantStartMonth": null,
                  "transplantEndMonth": null,
                  "harvestStartMonth": 7,
                  "harvestEndMonth": 9,
                  "daysToMaturityMin": 60,
                  "daysToMaturityMax": 75,
                  "successionIntervalDays": 14,
                  "rotationRestSeasons": 2
                }
              }
            },
            {
              "plantId": "plant-2",
              "taxonomyReferenceId": null,
              "seasonalFact": {"status": "noSeasonalData"}
            }
          ],
          "rotationStatus": [
            {
              "plantId": "plant-1",
              "gardenAreaMapObjectId": "bed-1",
              "family": "Solanaceae",
              "priorFamily": "Solanaceae",
              "priorOccupancyEndedAt": "2026-06-20T05:00:00.000Z",
              "elapsedDays": 30,
              "rotationRestSeasons": 2,
              "restPeriodThresholdDays": 730,
              "withinRestPeriod": true
            },
            {
              "plantId": "plant-2",
              "gardenAreaMapObjectId": "bed-2",
              "family": "Brassicaceae",
              "priorFamily": null,
              "priorOccupancyEndedAt": null,
              "elapsedDays": null,
              "rotationRestSeasons": null,
              "restPeriodThresholdDays": null,
              "withinRestPeriod": false
            }
          ]
        }
        """#

    @Test("getSeasonalPlan requests the seasonal-plan path and decodes hemisphere, reviewed/noSeasonalData plants, and rotation status")
    func decodesFullResult() async throws {
        let identifier = "seasonal-plan-get"
        defer { StubURLProtocol.unregister(identifier) }

        let gateway = makeGateway(identifier: identifier, answer: .json(200, Self.resultJSON))
        let result = try await gateway.getSeasonalPlan(gardenId: "garden-1")

        let request = try #require(StubURLProtocol.requests(forSession: identifier).first)
        #expect(request.url?.path == "/v1/gardens/garden-1/seasonal-plan")
        #expect(request.httpMethod == "GET")

        #expect(result.gardenId == "garden-1")
        #expect(result.hemisphere == .northern)
        #expect(result.plants.count == 2)

        let reviewed = try #require(result.plants.first)
        #expect(reviewed.taxonomyReferenceId == "taxon-1")
        guard case let .reviewed(timing) = reviewed.seasonalFact else {
            Issue.record("Expected a reviewed seasonal fact")
            return
        }
        #expect(timing.sowIndoorsStartMonth == 2)
        #expect(timing.sowIndoorsEndMonth == 3)
        #expect(timing.transplantStartMonth == nil)
        #expect(timing.rotationRestSeasons == 2)

        let missing = try #require(result.plants.last)
        #expect(missing.taxonomyReferenceId == nil)
        #expect(missing.seasonalFact == .noSeasonalData)

        #expect(result.rotationStatus.count == 2)
        let conflict = try #require(result.rotationStatus.first)
        #expect(conflict.withinRestPeriod == true)
        #expect(conflict.elapsedDays == 30)
        #expect(conflict.restPeriodThresholdDays == 730)

        let clear = try #require(result.rotationStatus.last)
        #expect(clear.withinRestPeriod == false)
        #expect(clear.priorFamily == nil)
        #expect(clear.elapsedDays == nil)
    }

    @Test("getSeasonalPlan decodes a null hemisphere as the explicit hemisphere-unknown signal")
    func decodesNullHemisphere() async throws {
        let identifier = "seasonal-plan-no-hemisphere"
        defer { StubURLProtocol.unregister(identifier) }

        let body = #"{"gardenId": "garden-1", "hemisphere": null, "plants": [], "rotationStatus": []}"#
        let gateway = makeGateway(identifier: identifier, answer: .json(200, body))

        let result = try await gateway.getSeasonalPlan(gardenId: "garden-1")

        #expect(result.hemisphere == nil)
        #expect(result.plants.isEmpty)
        #expect(result.rotationStatus.isEmpty)
    }
}
