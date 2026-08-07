import CoreDomain
import CoreNetworking

/// What an observation can be about, by name rather than by identifier.
///
/// The record sheet used to ask for a raw UUID — one for a plant and one for a
/// map object — and its own hint admitted it. Nobody knows a UUID, so in
/// practice an observation could only ever be about the whole garden. These
/// read the two lists the garden already has.
///
/// Thin use cases over gateways this feature already reaches, declared here
/// rather than imported from a sibling: a feature may not name another feature,
/// and four duplicated lines are cheaper than the dependency that would fix it.
public struct ListObservationTargetPlants: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [Plant] {
        try await gateway.searchPlants(
            gardenId: gardenId,
            query: nil,
            status: nil,
            identified: nil,
            filters: PlantSearchFilters(),
            cursor: nil,
            limit: nil
        ).items
    }
}

public struct ListObservationTargetObjects: Sendable {
    private let gateway: any MapGateway

    public init(gateway: any MapGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [GardenMapObject] {
        try await gateway.getMap(gardenId: gardenId).objects
    }
}
