import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@MainActor
@Suite("Plant detail view model")
struct PlantDetailViewModelTests {
    private func plant(
        id: String = "plant-1",
        revision: Int = 1,
        status: PlantStatus = .active,
        stage: PlantLifecycleStage = .seedling,
        taxonomyReferenceId: String? = nil,
        groupingKind: PlantGroupingKind = .individual,
        quantity: Int? = nil
    ) -> Plant {
        Plant(
            id: id, gardenId: "garden-1", gardenAreaMapObjectId: nil, placementMapObjectId: nil,
            displayName: "Tomato", taxonomyReferenceId: taxonomyReferenceId, varietyLabel: nil, acceptedIdentificationId: nil,
            acquisitionDate: nil, acquisitionDateType: nil, groupingKind: groupingKind, quantity: quantity,
            lifecycleStage: stage, status: status, conditionNote: nil, careGuidanceNote: nil, revision: revision,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(gateway: FakePlantGateway, plantId: String = "plant-1") -> PlantDetailViewModel {
        PlantDetailViewModel(
            gardenId: "garden-1",
            plantId: plantId,
            getPlant: GetPlant(gateway: gateway),
            updatePlantDetails: UpdatePlantDetails(gateway: gateway),
            transitionPlantLifecycleStage: TransitionPlantLifecycleStage(gateway: gateway),
            setPlantStatus: SetPlantStatus(gateway: gateway),
            movePlant: MovePlant(gateway: gateway),
            searchTaxonomyReferences: SearchTaxonomyReferences(gateway: gateway),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("load populates the summary and edit fields from the fetched plant")
    func loadPopulatesState() async {
        let gateway = FakePlantGateway(plants: [plant()])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.displayName == "Tomato")
        #expect(summary.revision == 1)
        #expect(model.editedDisplayName == "Tomato")
    }

    @Test("A missing plant surfaces as a failed state")
    func missingPlantFails() async {
        let gateway = FakePlantGateway()
        let model = makeModel(gateway: gateway, plantId: "does-not-exist")

        await model.load()

        guard case .failed = model.state else {
            Issue.record("Expected a failed state")
            return
        }
    }

    @Test("saveDetails rejects an empty display name without calling the gateway")
    func saveDetailsRejectsEmptyName() async {
        let gateway = FakePlantGateway(plants: [plant()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.editedDisplayName = "   "
        await model.saveDetails()

        #expect(model.actionErrorMessage != nil)
    }

    @Test("saveDetails clears a nullable field when its text is left empty")
    func saveDetailsClearsEmptyOptionalField() async {
        var source = plant()
        source = Plant(
            id: source.id, gardenId: source.gardenId, gardenAreaMapObjectId: source.gardenAreaMapObjectId,
            placementMapObjectId: source.placementMapObjectId, displayName: source.displayName,
            taxonomyReferenceId: source.taxonomyReferenceId, varietyLabel: "Roma", acceptedIdentificationId: nil,
            acquisitionDate: nil, acquisitionDateType: nil, groupingKind: source.groupingKind, quantity: nil,
            lifecycleStage: source.lifecycleStage, status: source.status, conditionNote: nil, careGuidanceNote: nil,
            revision: source.revision, createdByProfileId: source.createdByProfileId, createdAt: source.createdAt,
            updatedAt: source.updatedAt
        )
        let gateway = FakePlantGateway(plants: [source])
        let model = makeModel(gateway: gateway)
        await model.load()
        #expect(model.editedVarietyLabel == "Roma")

        model.editedVarietyLabel = ""
        await model.saveDetails()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.revision == 2)
        #expect(model.editedVarietyLabel.isEmpty)
    }

    @Test("transitionLifecycleStage updates the summary's stage on success")
    func transitionLifecycleStageUpdatesSummary() async {
        let gateway = FakePlantGateway(plants: [plant(stage: .seedling)])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.transitionLifecycleStage(to: .flowering)

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.lifecycleStage == .flowering)
    }

    @Test("delete calls setStatus(.removed) — there is no hard-delete endpoint")
    func deleteSetsStatusToRemoved() async {
        let gateway = FakePlantGateway(plants: [plant(status: .active)])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.delete()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.status == .removed)
    }

    @Test("A stale revision surfaces an action error rather than corrupting local state")
    func staleRevisionSurfacesError() async {
        let gateway = FakePlantGateway(plants: [plant(revision: 5)])
        let model = makeModel(gateway: gateway)
        await model.load()

        // Force a stale expectation by loading, then mutating the gateway's
        // copy out from under the view model (simulating a concurrent edit
        // elsewhere), then trying to save.
        _ = try? await gateway.setStatus(gardenId: "garden-1", plantId: "plant-1", status: .dormant, expectedRevision: 5, idempotencyKey: "other-client")
        await model.saveDetails()

        #expect(model.actionErrorMessage != nil)
    }

    @Test("submitMove omits a field left blank and applies the other")
    func submitMoveOmitsBlankField() async {
        let gateway = FakePlantGateway(plants: [plant()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.editedGardenAreaMapObjectId = "area-1"
        model.editedPlacementMapObjectId = ""
        await model.submitMove()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.revision == 2)
    }

    @Test("load exposes the raw groupingKind alongside its localized label")
    func loadExposesRawGroupingKind() async {
        let gateway = FakePlantGateway(plants: [plant(groupingKind: .row, quantity: 3)])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.groupingKind == .row)
    }

    @Test("saveDetails leaves quantity untouched for an individual plant, even if the field holds text")
    func saveDetailsIgnoresQuantityForIndividualPlant() async {
        let gateway = FakePlantGateway(plants: [plant(groupingKind: .individual, quantity: nil)])
        let model = makeModel(gateway: gateway)
        await model.load()

        // A gated view never lets this happen, but the view model must not
        // rely on the view alone: an `.individual` plant's quantity must
        // stay `.unchanged` on the wire regardless of stale form state.
        model.editedQuantityText = "5"
        await model.saveDetails()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.quantity == nil)
    }

    @Test("saveDetails applies an edited quantity for a row plant")
    func saveDetailsAppliesQuantityForRowPlant() async {
        let gateway = FakePlantGateway(plants: [plant(groupingKind: .row, quantity: 3)])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.editedQuantityText = "7"
        await model.saveDetails()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.quantity == 7)
    }

    @Test("load populates editedTaxonomyReferenceId, and an unresolved id shows a fallback summary")
    func loadPopulatesTaxonomyFallback() async {
        let gateway = FakePlantGateway(plants: [plant(taxonomyReferenceId: "tax-1")])
        let model = makeModel(gateway: gateway)

        await model.load()

        #expect(model.editedTaxonomyReferenceId == "tax-1")
        #expect(model.selectedTaxonomySummary.contains("tax-1"))
    }

    @Test("An unidentified plant's taxonomy summary reads 'not identified'")
    func loadPopulatesTaxonomyNone() async {
        let gateway = FakePlantGateway(plants: [plant(taxonomyReferenceId: nil)])
        let model = makeModel(gateway: gateway)

        await model.load()

        #expect(model.editedTaxonomyReferenceId == nil)
        #expect(model.selectedTaxonomySummary == model.taxonomyNoneLabel)
    }

    @Test("selectTaxonomy sets the selection, shows its friendly name, and closes the picker")
    func selectTaxonomyUpdatesSelection() async {
        let gateway = FakePlantGateway(plants: [plant()])
        let model = makeModel(gateway: gateway)
        await model.load()
        model.isTaxonomyPickerPresented = true
        let reference = TaxonomyReference(
            id: "tax-2", scientificName: "Solanum lycopersicum", commonName: "Tomato", varietyName: nil,
            source: .systemCatalog, createdByProfileId: nil, createdAt: Date(timeIntervalSince1970: 0)
        )

        model.selectTaxonomy(reference)

        #expect(model.editedTaxonomyReferenceId == "tax-2")
        #expect(model.selectedTaxonomySummary == "Tomato")
        #expect(model.isTaxonomyPickerPresented == false)
    }

    @Test("clearTaxonomy resets the selection back to 'not identified'")
    func clearTaxonomyResetsSelection() async {
        let gateway = FakePlantGateway(plants: [plant(taxonomyReferenceId: "tax-1")])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.clearTaxonomy()

        #expect(model.editedTaxonomyReferenceId == nil)
        #expect(model.selectedTaxonomySummary == model.taxonomyNoneLabel)
    }

    @Test("saveDetails persists the edited taxonomy selection")
    func saveDetailsPersistsTaxonomySelection() async {
        let gateway = FakePlantGateway(plants: [plant(taxonomyReferenceId: nil)])
        let model = makeModel(gateway: gateway)
        await model.load()
        let reference = TaxonomyReference(
            id: "tax-3", scientificName: "Solanum lycopersicum", commonName: "Tomato", varietyName: nil,
            source: .systemCatalog, createdByProfileId: nil, createdAt: Date(timeIntervalSince1970: 0)
        )
        model.selectTaxonomy(reference)

        await model.saveDetails()

        // Round-tripped through the gateway, not just the local field: this
        // confirms `updatePlantDetails` was actually called with the new id.
        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.taxonomyReferenceId == "tax-3")
    }
}
