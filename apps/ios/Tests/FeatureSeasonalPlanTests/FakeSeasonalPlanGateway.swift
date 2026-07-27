import CoreDomain
import CoreNetworking
import Foundation

@testable import FeatureSeasonalPlan

/// In-memory, non-networked stand-in for `SeasonalPlanGateway` — mirrors
/// `FeatureRecommendationsTests/FakeRecommendationGateway`'s exact shape
/// (in-memory, `@unchecked Sendable`, a `nextFailure` knob, recorded call
/// state).
final class FakeSeasonalPlanGateway: SeasonalPlanGateway, @unchecked Sendable {
    var result: SeasonalPlanResult
    /// When set, the next call throws this once instead of answering.
    var nextFailure: APIGatewayError?

    private(set) var requestedGardenIds: [String] = []

    init(result: SeasonalPlanResult = SeasonalPlanFixtures.result()) {
        self.result = result
    }

    func getSeasonalPlan(gardenId: String) async throws -> SeasonalPlanResult {
        if let failure = nextFailure {
            nextFailure = nil
            throw failure
        }
        requestedGardenIds.append(gardenId)
        return result
    }
}
