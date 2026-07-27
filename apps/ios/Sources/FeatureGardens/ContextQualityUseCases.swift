import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for the Context quality screen (P9D-UX-01).
///
/// ONLINE, gateway-backed — the same documented posture
/// `FeatureRecommendations.TodayUseCases`/`CoreNetworking
/// .GardenContextGateway` establish: a context fact is a small,
/// occasionally-edited, server-owned upsert, not a synced record family, so
/// no local projection is built here either.
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `GardenContext`.
public struct ListGardenContextFacts: Sendable {
    private let gateway: any GardenContextGateway

    public init(gateway: any GardenContextGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> GardenContextFactListResult {
        try await gateway.listGardenContextFacts(gardenId: gardenId)
    }
}

/// Declares or updates one context fact. `source` is always
/// `.userDeclared` at this call site — see `ContextQualityViewModel`'s own
/// doc comment for why this screen offers no picker for
/// `.horticulturallyReviewedDefault`/`.imported`.
public struct RecordGardenContextFact: Sendable {
    private let gateway: any GardenContextGateway

    public init(gateway: any GardenContextGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        contextKind: GardenContextKind,
        value: String
    ) async throws -> GardenContextFact {
        try await gateway.recordGardenContextFact(
            gardenId: gardenId,
            contextKind: contextKind,
            value: value,
            source: .userDeclared,
            reviewedBy: nil,
            reviewedOn: nil
        )
    }
}
