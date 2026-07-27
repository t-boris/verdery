import CoreDomain
import CoreNetworking
import Foundation

/// Use case for the Seasonal plan surface (P9D-UX-01).
///
/// ONLINE, gateway-backed — a deliberate, documented posture, not a gap,
/// the same one `FeatureRecommendations.TodayUseCases` established: a
/// garden's seasonal plan is not a synced record family, so no local
/// projection is built; the screen degrades honestly when offline instead.
/// See `CoreNetworking.SeasonalPlanGateway`'s own doc comment.
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
public struct LoadSeasonalPlan: Sendable {
    private let gateway: any SeasonalPlanGateway

    public init(gateway: any SeasonalPlanGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> SeasonalPlanResult {
        try await gateway.getSeasonalPlan(gardenId: gardenId)
    }
}
