import CoreDomain
import CoreNetworking
import Foundation

/// The plant inventory's read-only use cases — split out of `PlantsUseCases.swift`
/// purely to keep that file under this repository's 600-line rule, the same
/// `CollaboratorsViewModel+Actions.swift` precedent. All are still online,
/// gateway-backed reads — see `PlantsUseCases.AddPlant`'s own doc comment for
/// the shared rationale.
public struct SearchTaxonomyReferences: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, query: String? = nil, limit: Int? = nil) async throws -> [TaxonomyReference] {
        try await gateway.searchTaxonomyReferences(gardenId: gardenId, query: query, limit: limit)
    }
}

/// No local caching: unlike a single plant's own detail screen, a search
/// result page has no meaningful offline fallback (the app has no local
/// index to search against), matching `SearchTaxonomyReferences`'s own
/// identical choice.
public struct SearchPlants: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(
        gardenId: String,
        query: String? = nil,
        status: [PlantStatus]? = nil,
        identified: Bool? = nil,
        filters: PlantSearchFilters = .none,
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> PlantSearchPage {
        try await gateway.searchPlants(
            gardenId: gardenId,
            query: query,
            status: status,
            identified: identified,
            filters: filters,
            cursor: cursor,
            limit: limit
        )
    }
}

/// Which placement field a `MapObjectPickerView` presentation is choosing
/// for — shared by `PlantsHomeViewModel`'s add-form and
/// `PlantDetailViewModel`'s move section, the two places offering this
/// picker.
public enum MapObjectPlacementField: Sendable {
    case gardenArea
    case placement
}

/// Lists a garden's active map objects, for the `gardenAreaMapObjectId`/
/// `placementMapObjectId` picker — the backend itself places no category
/// restriction on either field (`requirePlacementReferencesGardenObjects`
/// only requires the object be `active`, plants-inventory/application/
/// require-plant-placement-in-garden.ts), so this offers the same full list
/// for both.
///
/// Depends on `MapGateway` directly (a `CoreNetworking` protocol, not the
/// `FeatureMap` module) — the legal shape for `FeaturePlants` to read map
/// data without importing another feature (`DependencyRuleTests
/// .featuresDoNotDependOnEachOther`). `MapGateway.getMap` already returns
/// every object in one call; there is no separate "list objects" endpoint
/// to call instead.
public struct ListGardenMapObjects: Sendable {
    private let gateway: any MapGateway

    public init(gateway: any MapGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [GardenMapObject] {
        let document = try await gateway.getMap(gardenId: gardenId)
        return document.objects.filter { $0.lifecycleState == .active }
    }
}

public struct ListPlantPhotos: Sendable {
    private let gateway: any PlantGateway

    public init(gateway: any PlantGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, plantId: String) async throws -> [PlantPhoto] {
        try await gateway.listPlantPhotos(gardenId: gardenId, plantId: plantId)
    }
}
