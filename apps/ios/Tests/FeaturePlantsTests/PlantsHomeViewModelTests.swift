import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@MainActor
@Suite("Plants home view model")
struct PlantsHomeViewModelTests {
    private func makeModel(
        gateway: FakePlantGateway,
        mapGateway: FakePlantsMapGateway? = nil
    ) -> PlantsHomeViewModel {
        PlantsHomeViewModel(
            gardenId: "garden-1",
            addPlant: AddPlant(localStore: InMemoryPlantStore(), profileId: "profile-1"),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB")),
            listGardenMapObjects: mapGateway.map { ListGardenMapObjects(gateway: $0) }
        )
    }

    @Test("A successful add clears the form and sets navigateToPlantId to the created plant")
    func successfulAddNavigatesToCreatedPlant() async {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)
        model.displayName = "Tomato"
        model.groupingKind = .individual

        await model.submitAddPlant()

        #expect(model.state == .idle)
        #expect(model.displayName.isEmpty)
        #expect(model.navigateToPlantId != nil)
    }

    @Test("A successful add never reaches the gateway — the created plant exists only locally (P5-IOS-02)")
    func successfulAddNeverCallsGateway() async throws {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)
        model.displayName = "Tomato"
        model.groupingKind = .individual

        await model.submitAddPlant()

        let createdPlantId = try #require(model.navigateToPlantId)
        // `FakePlantGateway` never learned about this plant — if `AddPlant`
        // had called through to it, `getPlant` would find it.
        await #expect(throws: (any Error).self) {
            try await gateway.getPlant(gardenId: "garden-1", plantId: createdPlantId)
        }
    }

    @Test("A validation failure surfaces as a failed state and does not call the gateway")
    func validationFailureDoesNotCallGateway() async {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)
        model.displayName = ""

        await model.submitAddPlant()

        guard case .failed = model.state else {
            Issue.record("Expected a failed state")
            return
        }
        #expect(model.navigateToPlantId == nil)
    }

    @Test("A row grouping kind requires a positive quantity before the gateway is called")
    func rowRequiresQuantityBeforeSubmitting() async {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)
        model.displayName = "Carrots"
        model.groupingKind = .row
        model.quantityText = ""

        await model.submitAddPlant()

        guard case .failed = model.state else {
            Issue.record("Expected a failed state")
            return
        }
        #expect(model.navigateToPlantId == nil)
    }

    @Test("selectTaxonomy sets the selection and closes the picker")
    func selectTaxonomyClosesPicker() {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)
        model.isTaxonomyPickerPresented = true
        let reference = TaxonomyReference(
            id: "tax-1", scientificName: "Solanum lycopersicum", commonName: "Tomato", varietyName: nil,
            source: .systemCatalog, createdByProfileId: nil, createdAt: Date(timeIntervalSince1970: 0)
        )

        model.selectTaxonomy(reference)

        #expect(model.selectedTaxonomySummary == "Tomato")
        #expect(model.isTaxonomyPickerPresented == false)
    }

    @Test("clearTaxonomy resets the selection back to 'not identified'")
    func clearTaxonomyResetsSelection() {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)
        let reference = TaxonomyReference(
            id: "tax-1", scientificName: "Solanum lycopersicum", commonName: "Tomato", varietyName: nil,
            source: .systemCatalog, createdByProfileId: nil, createdAt: Date(timeIntervalSince1970: 0)
        )
        model.selectTaxonomy(reference)

        model.clearTaxonomy()

        #expect(model.selectedTaxonomySummary == model.taxonomyNoneLabel)
    }

    @Test("searchTaxonomy passes a trimmed, non-empty query through and nil when blank")
    func searchTaxonomyTrimsQuery() async {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)

        _ = await model.searchTaxonomy(query: "  tomato  ")
        _ = await model.searchTaxonomy(query: "   ")

        #expect(gateway.searchQueries == ["tomato", nil])
    }

    @Test("openPlant trims the id and sets navigateToPlantId, ignoring a blank field")
    func openPlantTrimsAndNavigates() {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)

        model.openPlantId = "   "
        model.openPlant()
        #expect(model.navigateToPlantId == nil)

        model.openPlantId = "  plant-42  "
        model.openPlant()
        #expect(model.navigateToPlantId == "plant-42")
        #expect(model.openPlantId.isEmpty)
    }

    @Test("consumeNavigation clears navigateToPlantId")
    func consumeNavigationClears() {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)
        model.openPlantId = "plant-1"
        model.openPlant()

        model.consumeNavigation()

        #expect(model.navigateToPlantId == nil)
    }

    @Test("openMapObjectPicker loads the garden's active objects and selectMapObject sets the chosen field")
    func mapObjectPickerSelectsField() async {
        let gateway = FakePlantGateway()
        let mapGateway = FakePlantsMapGateway()
        mapGateway.objects = [
            makeMapObject(id: "zone-1", label: "Front bed"),
            makeMapObject(id: "zone-2", label: "Back bed"),
        ]
        let model = makeModel(gateway: gateway, mapGateway: mapGateway)

        await model.openMapObjectPicker(for: .gardenArea)
        #expect(model.mapObjects.map(\.id) == ["zone-1", "zone-2"])

        model.selectMapObject("zone-1")

        #expect(model.gardenAreaMapObjectId == "zone-1")
        #expect(model.mapObjectSummary(for: .gardenArea) == "Front bed")
        #expect(model.placementMapObjectId.isEmpty)
    }

    @Test("selectMapObject with nil clears the field back to empty")
    func mapObjectPickerClearsField() async {
        let gateway = FakePlantGateway()
        let mapGateway = FakePlantsMapGateway()
        mapGateway.objects = [makeMapObject(id: "zone-1", label: "Front bed")]
        let model = makeModel(gateway: gateway, mapGateway: mapGateway)
        await model.openMapObjectPicker(for: .placement)
        model.selectMapObject("zone-1")

        await model.openMapObjectPicker(for: .placement)
        model.selectMapObject(nil)

        #expect(model.placementMapObjectId.isEmpty)
        #expect(model.mapObjectSummary(for: .placement) == nil)
    }

    @Test("openMapObjectPicker with no map-object capability wired in is a no-op")
    func mapObjectPickerNoOpWithoutCapability() async {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway)

        await model.openMapObjectPicker(for: .gardenArea)

        #expect(model.mapObjects.isEmpty)
        #expect(model.activeMapObjectField == nil)
    }
}
