import CoreDomain
import CoreNetworking

/// What a task can be about, by name rather than by identifier.
///
/// The create sheet used to ask for a raw UUID in a text field — for a garden
/// area and again for a plant. Nobody knows a UUID, so in practice those two
/// fields made the target unusable and the sheet's own hint said as much.
/// These read the two lists the garden already has, so choosing a target is
/// recognising a name.
///
/// Thin use cases over gateways this feature already reaches, declared here
/// rather than imported from a sibling: a feature may not name another feature,
/// and duplicating four lines is cheaper than the dependency that would fix it.
public struct ListTaskTargetAreas: Sendable {
    private let gateway: any MapGateway

    public init(gateway: any MapGateway) {
        self.gateway = gateway
    }

    /// Only the objects a task can sensibly be about. A fence or a path is a
    /// real map object and a poor target for "water this".
    public func callAsFunction(gardenId: String) async throws -> [GardenMapObject] {
        try await gateway.getMap(gardenId: gardenId).objects.filter {
            $0.category == .bed || $0.category == .zone
        }
    }
}

public struct ListTaskTargetPlants: Sendable {
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
