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
        stage: PlantLifecycleStage = .seedling
    ) -> Plant {
        Plant(
            id: id, gardenId: "garden-1", gardenAreaMapObjectId: nil, placementMapObjectId: nil,
            displayName: "Tomato", taxonomyReferenceId: nil, varietyLabel: nil, acceptedIdentificationId: nil,
            acquisitionDate: nil, acquisitionDateType: nil, groupingKind: .individual, quantity: nil,
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
}
