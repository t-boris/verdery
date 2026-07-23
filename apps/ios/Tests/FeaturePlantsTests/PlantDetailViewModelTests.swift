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

    private func makeModel(
        gateway: FakePlantGateway,
        localStore: any LocalPlantStore = InMemoryPlantStore(),
        plantId: String = "plant-1"
    ) -> PlantDetailViewModel {
        PlantDetailViewModel(
            gardenId: "garden-1",
            plantId: plantId,
            getPlant: GetPlant(gateway: gateway, localStore: localStore),
            updatePlantDetails: UpdatePlantDetails(localStore: localStore, profileId: "profile-1"),
            transitionPlantLifecycleStage: TransitionPlantLifecycleStage(localStore: localStore, profileId: "profile-1"),
            setPlantStatus: SetPlantStatus(localStore: localStore, profileId: "profile-1"),
            movePlant: MovePlant(localStore: localStore, profileId: "profile-1"),
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
        // Unchanged locally (P5-IOS-02, Stage 4c): `saveDetails` now commits
        // through an offline transaction, and a locally-applied command never
        // advances the revision — the server, not this client, assigns the
        // next one, once the outbox operation this produced is actually
        // pushed.
        #expect(summary.revision == source.revision)
        #expect(summary.syncStatusLabel != nil)
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

    /// A `LocalPlantStore` that can be toggled to fail every
    /// `commitOfflineMutation` call, delegating to a real `InMemoryPlantStore`
    /// otherwise — mirrors `MapEditorViewModelSaveStatusTests
    /// .ToggleableLocalMapStore`'s identical role.
    private final class ToggleableLocalPlantStore: LocalPlantStore, @unchecked Sendable {
        private let inner = InMemoryPlantStore()
        var shouldFail = false

        func fetch(plantId: String) async throws -> Plant? {
            try await inner.fetch(plantId: plantId)
        }

        func save(_ plant: Plant) async throws {
            try await inner.save(plant)
        }

        func delete(plantId: String) async throws {
            try await inner.delete(plantId: plantId)
        }

        func commitOfflineMutation(
            plantId: String,
            command: @Sendable (_ current: Plant?) throws -> (projection: Plant, operation: OutboxOperation)
        ) async throws -> Plant {
            guard !shouldFail else { throw PlantCommandError.localRecordNotFound }
            return try await inner.commitOfflineMutation(plantId: plantId, command: command)
        }

        func confirmSynced(plantId: String, revision: Int) async throws {
            try await inner.confirmSynced(plantId: plantId, revision: revision)
        }

        func removeAll(gardenId: String) async throws {
            try await inner.removeAll(gardenId: gardenId)
        }
    }

    /// A stale server revision can no longer be what causes `saveDetails` to
    /// fail from this call path: as of P5-IOS-02 (Stage 4c), the command
    /// commits entirely locally and never round-trips through a gateway that
    /// could reject it with a `409`/`412`. That discovery is now the
    /// server's job once a real push engine exists (P5-CONFLICT-01) — this
    /// test instead covers what actually can fail this transaction today: a
    /// local commit failure. Mirrors Stage 4b's identical rewrite of its own
    /// stale-revision test into a local-commit-failure test.
    @Test("A local commit failure surfaces an action error rather than corrupting local state")
    func localCommitFailureSurfacesError() async {
        let gateway = FakePlantGateway(plants: [plant(revision: 5)])
        let store = ToggleableLocalPlantStore()
        let model = makeModel(gateway: gateway, localStore: store)
        await model.load()
        store.shouldFail = true

        await model.saveDetails()

        #expect(model.actionErrorMessage != nil)
    }

    @Test("submitMove omits a field left blank and applies the other, saved locally")
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
        #expect(model.actionErrorMessage == nil)
        #expect(summary.syncStatusLabel != nil)
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

    @Test("saveDetails rejects a missing row quantity before calling the gateway")
    func saveDetailsRejectsMissingRowQuantity() async {
        let gateway = FakePlantGateway(plants: [plant(groupingKind: .row, quantity: 3)])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.editedQuantityText = ""
        await model.saveDetails()

        #expect(model.actionErrorMessage != nil)
        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected the loaded state to remain unchanged")
            return
        }
        #expect(summary.quantity == 3)
        #expect(summary.revision == 1)
    }

    @Test("saveDetails rejects a non-positive group quantity before calling the gateway")
    func saveDetailsRejectsNonPositiveGroupQuantity() async {
        let gateway = FakePlantGateway(plants: [plant(groupingKind: .group, quantity: 4)])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.editedQuantityText = "0"
        await model.saveDetails()

        #expect(model.actionErrorMessage != nil)
        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected the loaded state to remain unchanged")
            return
        }
        #expect(summary.quantity == 4)
        #expect(summary.revision == 1)
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
