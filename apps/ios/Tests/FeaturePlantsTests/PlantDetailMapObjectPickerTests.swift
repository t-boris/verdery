import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

/// `PlantDetailViewModel`'s own map-object-picker coverage, split out of
/// `PlantDetailViewModelTests.swift` for the same 600-line reason this
/// codebase's own source files split — see that file's own header.
@MainActor
@Suite("Plant detail view model — map object picker")
struct PlantDetailMapObjectPickerTests {
    private func makeModel(
        gateway: FakePlantGateway = FakePlantGateway(),
        mapGateway: FakePlantsMapGateway? = nil
    ) -> PlantDetailViewModel {
        let localStore = InMemoryPlantStore()
        return PlantDetailViewModel(
            gardenId: "garden-1",
            plantId: "plant-1",
            getPlant: GetPlant(gateway: gateway, localStore: localStore),
            updatePlantDetails: UpdatePlantDetails(localStore: localStore, profileId: "profile-1"),
            transitionPlantLifecycleStage: TransitionPlantLifecycleStage(localStore: localStore, profileId: "profile-1"),
            setPlantStatus: SetPlantStatus(localStore: localStore, profileId: "profile-1"),
            movePlant: MovePlant(localStore: localStore, profileId: "profile-1"),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB")),
            listGardenMapObjects: mapGateway.map { ListGardenMapObjects(gateway: $0) }
        )
    }

    @Test("openMapObjectPicker loads the garden's active objects and selectMapObject sets the chosen field")
    func mapObjectPickerSelectsField() async {
        let mapGateway = FakePlantsMapGateway()
        mapGateway.objects = [
            makeMapObject(id: "zone-1", label: "Front bed"),
            makeMapObject(id: "zone-2", label: "Back bed"),
        ]
        let model = makeModel(mapGateway: mapGateway)

        await model.openMapObjectPicker(for: .placement)
        #expect(model.mapObjects.map(\.id) == ["zone-1", "zone-2"])

        model.selectMapObject("zone-2")

        #expect(model.editedPlacementMapObjectId == "zone-2")
        #expect(model.mapObjectSummary(for: .placement) == "Back bed")
        #expect(model.editedGardenAreaMapObjectId.isEmpty)
    }

    @Test("selectMapObject with nil clears the field back to empty")
    func mapObjectPickerClearsField() async {
        let mapGateway = FakePlantsMapGateway()
        mapGateway.objects = [makeMapObject(id: "zone-1", label: "Front bed")]
        let model = makeModel(mapGateway: mapGateway)
        await model.openMapObjectPicker(for: .gardenArea)
        model.selectMapObject("zone-1")

        await model.openMapObjectPicker(for: .gardenArea)
        model.selectMapObject(nil)

        #expect(model.editedGardenAreaMapObjectId.isEmpty)
        #expect(model.mapObjectSummary(for: .gardenArea) == nil)
    }

    @Test("openMapObjectPicker with no map-object capability wired in is a no-op")
    func mapObjectPickerNoOpWithoutCapability() async {
        let model = makeModel()

        await model.openMapObjectPicker(for: .gardenArea)

        #expect(model.mapObjects.isEmpty)
        #expect(model.activeMapObjectField == nil)
    }
}
