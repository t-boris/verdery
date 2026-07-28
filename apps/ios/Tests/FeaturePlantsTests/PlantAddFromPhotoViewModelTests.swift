import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeaturePlants

@MainActor
@Suite("Plant add from photo view model")
struct PlantAddFromPhotoViewModelTests {
    private func makeModel(gateway: FakePlantGateway) -> PlantAddFromPhotoViewModel {
        PlantAddFromPhotoViewModel(
            gardenId: "garden-1",
            addPlantFromPhoto: AddPlantFromPhoto(gateway: gateway, generateIdempotencyKey: { "fixed-key" }),
            fetchPlantIdentification: FetchPlantIdentification(gateway: gateway),
            confirmPlantIdentification: ConfirmPlantIdentification(gateway: gateway, generateIdempotencyKey: { "fixed-key" }),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("photoReady creates the plant and moves to reviewing with the fetched suggestion")
    func photoReadyMovesToReviewing() async {
        let gateway = FakePlantGateway(plants: [])
        gateway.pendingIdentification = PlantIdentification(
            id: "identification-1",
            plantId: "plant-1",
            plantPhotoId: "photo-1",
            confidenceScore: 0.81,
            createdAt: Date(timeIntervalSince1970: 0),
            suggestedTaxonomy: PlantIdentificationSuggestion(
                id: "tax-1", scientificName: "Ocimum basilicum", commonName: "Basil"
            )
        )
        let model = makeModel(gateway: gateway)

        await model.photoReady(mediaId: "media-1")

        guard case let .reviewing(_, identification) = model.state else {
            Issue.record("Expected reviewing state")
            return
        }
        #expect(identification?.suggestedTaxonomy?.commonName == "Basil")
    }

    @Test("photoReady surfaces the variety, growth-stage, condition, and care-guidance guesses")
    func photoReadySurfacesDetailGuesses() async {
        let gateway = FakePlantGateway(plants: [])
        gateway.pendingIdentification = PlantIdentification(
            id: "identification-1",
            plantId: "plant-1",
            plantPhotoId: "photo-1",
            confidenceScore: 0.9,
            createdAt: Date(timeIntervalSince1970: 0),
            suggestedTaxonomy: PlantIdentificationSuggestion(
                id: "tax-1", scientificName: "Solanum lycopersicum", commonName: "Tomato"
            ),
            suggestedVarietyLabel: "Roma",
            suggestedLifecycleStage: .flowering,
            suggestedConditionNote: "Leaves show mild water stress",
            suggestedCareGuidanceNote: "Water more consistently and check drainage."
        )
        let model = makeModel(gateway: gateway)

        await model.photoReady(mediaId: "media-1")

        guard case let .reviewing(_, identification) = model.state else {
            Issue.record("Expected reviewing state")
            return
        }
        #expect(identification?.suggestedVarietyLabel == "Roma")
        #expect(identification?.suggestedLifecycleStage == .flowering)
        #expect(model.growthStageName(.flowering) == "Flowering")
        #expect(identification?.suggestedConditionNote == "Leaves show mild water stress")
        #expect(identification?.suggestedCareGuidanceNote == "Water more consistently and check drainage.")
    }

    @Test("photoReady surfaces a gateway failure as .failed")
    func photoReadySurfacesFailure() async {
        let gateway = FakePlantGateway(plants: [])
        gateway.addPlantFromPhotoError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let model = makeModel(gateway: gateway)

        await model.photoReady(mediaId: "media-1")

        guard case .failed = model.state else {
            Issue.record("Expected failed state")
            return
        }
    }

    @Test("confirmSuggestion confirms against the gateway and reaches done")
    func confirmSuggestionReachesDone() async {
        let gateway = FakePlantGateway(plants: [])
        gateway.pendingIdentification = PlantIdentification(
            id: "identification-1",
            plantId: "plant-1",
            plantPhotoId: "photo-1",
            confidenceScore: 0.81,
            createdAt: Date(timeIntervalSince1970: 0),
            suggestedTaxonomy: PlantIdentificationSuggestion(
                id: "tax-1", scientificName: "Ocimum basilicum", commonName: "Basil"
            )
        )
        let model = makeModel(gateway: gateway)
        await model.photoReady(mediaId: "media-1")

        await model.confirmSuggestion()

        guard case .done = model.state else {
            Issue.record("Expected done state")
            return
        }
    }

    @Test("confirmSuggestion is a no-op when the identification found no confident candidate")
    func confirmSuggestionNoOpWithoutCandidate() async {
        let gateway = FakePlantGateway(plants: [])
        gateway.pendingIdentification = PlantIdentification(
            id: "identification-1",
            plantId: "plant-1",
            plantPhotoId: "photo-1",
            confidenceScore: 0,
            createdAt: Date(timeIntervalSince1970: 0),
            suggestedTaxonomy: nil
        )
        let model = makeModel(gateway: gateway)
        await model.photoReady(mediaId: "media-1")

        await model.confirmSuggestion()

        guard case .reviewing = model.state else {
            Issue.record("Expected to remain in reviewing state")
            return
        }
    }

    @Test("confirmSuggestion proceeds for the AI's raw name guess when it has no catalog match")
    func confirmSuggestionReachesDoneForRawGuess() async {
        let gateway = FakePlantGateway(plants: [])
        gateway.pendingIdentification = PlantIdentification(
            id: "identification-1",
            plantId: "plant-1",
            plantPhotoId: "photo-1",
            confidenceScore: 0.88,
            createdAt: Date(timeIntervalSince1970: 0),
            suggestedTaxonomy: nil,
            suggestedCommonName: "Green ash",
            suggestedScientificName: "Fraxinus pennsylvanica"
        )
        let model = makeModel(gateway: gateway)
        await model.photoReady(mediaId: "media-1")

        await model.confirmSuggestion()

        guard case .done = model.state else {
            Issue.record("Expected done state")
            return
        }
    }

    @Test("decideLater reaches done without confirming")
    func decideLaterReachesDone() async {
        let gateway = FakePlantGateway(plants: [])
        let model = makeModel(gateway: gateway)
        await model.photoReady(mediaId: "media-1")

        model.decideLater()

        guard case .done = model.state else {
            Issue.record("Expected done state")
            return
        }
    }

    @Test("a PlantAddFromPhotoViewModel with no photo-attachment capability wired in exposes no photoAttachment")
    func noPhotoAttachmentWiredByDefault() {
        let gateway = FakePlantGateway(plants: [])
        let model = makeModel(gateway: gateway)

        #expect(model.photoAttachment == nil)
    }
}
