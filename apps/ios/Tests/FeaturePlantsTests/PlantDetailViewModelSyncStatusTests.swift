import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

/// `PlantDetailSummary.syncStatusLabel` and the cache-first `load()` shape
/// P5-IOS-02 (Stage 4c) added — split out from `PlantDetailViewModelTests.swift`,
/// the same file-splitting convention `MapEditorViewModelSaveStatusTests.swift`
/// already established for its own feature's identical addition.
@MainActor
@Suite("Plant detail view model — sync status")
struct PlantDetailViewModelSyncStatusTests {
    private func plant(
        id: String = "plant-1",
        displayName: String = "Tomato",
        status: PlantStatus = .active,
        revision: Int = 3
    ) -> Plant {
        Plant(
            id: id, gardenId: "garden-1", gardenAreaMapObjectId: nil, placementMapObjectId: nil,
            displayName: displayName, taxonomyReferenceId: nil, varietyLabel: nil, acceptedIdentificationId: nil,
            acquisitionDate: nil, acquisitionDateType: nil, groupingKind: .individual, quantity: nil,
            lifecycleStage: .seedling, status: status, conditionNote: nil, careGuidanceNote: nil,
            revision: revision, createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0), updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(
        gateway: FakePlantGateway,
        localStore: any LocalPlantStore,
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

    @Test("syncStatusLabel is nil for a plant this session only ever read")
    func startsWithNoSyncStatus() async {
        let store = InMemoryPlantStore()
        let model = makeModel(gateway: FakePlantGateway(plants: [plant()]), localStore: store)

        await model.load()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.syncStatusLabel == nil)
    }

    @Test("A successful offline command sets syncStatusLabel")
    func successfulCommandSetsSyncStatus() async {
        let store = InMemoryPlantStore()
        let model = makeModel(gateway: FakePlantGateway(plants: [plant(status: .active)]), localStore: store)
        await model.load()

        await model.setStatus(.dormant)

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(summary.syncStatusLabel != nil)
    }

    /// The scenario `PlantDetailViewModel`'s own doc comment calls out
    /// explicitly: `PlantsHomeViewModel.performAdd()` navigates straight to
    /// this screen for a plant `AddPlant` may have just created purely
    /// locally. `getPlant`'s network fetch alone can never find it — this
    /// proves `load()`'s cache-first read is what makes the screen work
    /// anyway.
    @Test("load shows a plant that exists only in the local store, even though the network fetch would fail")
    func loadShowsLocallyCreatedPlantDespiteNetworkFailure() async {
        let store = InMemoryPlantStore()
        // Simulates `AddPlant`'s own optimistic write: a plant the fake
        // gateway has never heard of.
        try? await store.save(plant(id: "plant-offline", displayName: "Freshly Planted", revision: 0))
        let gateway = FakePlantGateway() // Empty: getPlant will 404.
        let model = makeModel(gateway: gateway, localStore: store, plantId: "plant-offline")

        await model.load()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected loaded state, not .failed — the cached row must carry the screen")
            return
        }
        #expect(summary.displayName == "Freshly Planted")
    }

    @Test("Once isSavedLocally is set, a later load() does not let a stale network response revert the UI")
    func laterLoadDoesNotOverwritePendingState() async {
        let store = InMemoryPlantStore()
        let gateway = FakePlantGateway(plants: [plant(displayName: "Tomato")])
        let model = makeModel(gateway: gateway, localStore: store)
        await model.load()

        model.editedDisplayName = "Cherry Tomato"
        await model.saveDetails()
        guard case let .loaded(afterSave) = model.state else {
            Issue.record("Expected loaded state after save")
            return
        }
        #expect(afterSave.displayName == "Cherry Tomato")

        // A second `load()` — as if the screen reappeared — still finds the
        // fake gateway's own unpushed copy ("Tomato"). Since `isSavedLocally`
        // is now `true`, that necessarily-stale response must not overwrite
        // the locally-edited state.
        await model.load()

        guard case let .loaded(afterReload) = model.state else {
            Issue.record("Expected loaded state after reload")
            return
        }
        #expect(afterReload.displayName == "Cherry Tomato")
    }
}
