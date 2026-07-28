import CoreDomain
import CoreNetworking
import Foundation

/// Minimal in-memory `MapGateway` stand-in for `ListGardenMapObjects`'s own
/// tests — only `getMap` is ever exercised from `FeaturePlants` (the picker
/// never submits a map command), unlike `FeatureMapTests.FakeMapGateway`,
/// which also fakes `submitCommand`'s full revision-guarded semantics.
final class FakePlantsMapGateway: MapGateway, @unchecked Sendable {
    var objects: [GardenMapObject] = []
    var getMapError: Error?

    func getMap(gardenId: String) async throws -> GardenMapDocument {
        if let getMapError { throw getMapError }
        return GardenMapDocument(coordinateSpaceId: "space-1", objects: objects)
    }

    func submitCommand(
        gardenId: String,
        command: MapCommandPayload,
        idempotencyKey: String
    ) async throws -> MapCommandResult {
        fatalError("FakePlantsMapGateway never submits a map command")
    }
}

func makeMapObject(
    id: String,
    category: GardenObjectCategory = .zone,
    label: String? = nil,
    lifecycleState: ObjectLifecycleState = .active
) -> GardenMapObject {
    GardenMapObject(
        id: id,
        gardenId: "garden-1",
        category: category,
        geometry: .point(Position(x: 0, y: 0)),
        coordinateSpaceId: "space-1",
        label: label,
        lifecycleState: lifecycleState,
        revision: 1,
        createdAt: Date(timeIntervalSince1970: 0),
        updatedAt: Date(timeIntervalSince1970: 0)
    )
}
