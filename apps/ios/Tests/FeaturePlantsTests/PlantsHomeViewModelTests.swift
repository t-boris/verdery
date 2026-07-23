import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@MainActor
@Suite("Plants home view model")
struct PlantsHomeViewModelTests {
    private func makeModel(gateway: FakePlantGateway) -> PlantsHomeViewModel {
        PlantsHomeViewModel(
            gardenId: "garden-1",
            addPlant: AddPlant(gateway: gateway),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
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
}
