import CoreDomain
import CoreNetworking

/// The undecided suggestions for a garden, whatever they target.
///
/// Filtered to one plant on the client rather than by the server, because
/// Today's own endpoint is the only read path the contract offers and it is
/// garden-scoped. The set is a small prioritized list by construction — the
/// server caps it — so filtering it here costs nothing and adds no endpoint.
public struct ListGardenProposals: Sendable {
    private let gateway: any RecommendationGateway

    public init(gateway: any RecommendationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [TodayRecommendation] {
        try await gateway.getTodayRecommendations(gardenId: gardenId, limit: nil).items
    }
}

/// The garden's outstanding tasks.
///
/// Fetched for the whole garden and narrowed to one plant here, for the same
/// reason as the proposals above: no per-plant task query exists, and a garden's
/// outstanding list is small.
public struct ListGardenOutstandingTasks: Sendable {
    private let gateway: any TaskGateway

    public init(gateway: any TaskGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [GardenTask] {
        try await gateway.listTasksForGarden(gardenId: gardenId, statuses: [.planned, .suggested])
    }
}

/// The conditions over a garden, as the scheduled sweep last stored them.
public struct GetGardenWeather: Sendable {
    private let gateway: any WeatherGateway

    public init(gateway: any WeatherGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> GardenWeather {
        try await gateway.getGardenWeather(gardenId: gardenId)
    }
}
