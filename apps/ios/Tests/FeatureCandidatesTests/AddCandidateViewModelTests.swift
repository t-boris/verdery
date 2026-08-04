import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureCandidates

@MainActor
@Suite("Add candidate view model")
struct AddCandidateViewModelTests {
    private func makeModel(gateway: FakePlantCandidateGateway) -> AddCandidateViewModel {
        AddCandidateViewModel(
            gardenId: "garden-1",
            addCandidate: AddCandidate(gateway: gateway),
            searchTaxonomyReferences: SearchCandidateTaxonomyReferences(gateway: FakeCandidatePlantGateway()),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("submit() rejects an empty display name without calling the gateway")
    func submitRejectsEmptyDisplayName() async {
        let gateway = FakePlantCandidateGateway()
        let model = makeModel(gateway: gateway)

        await model.submit()

        #expect(model.errorMessage != nil)
        #expect(model.createdCandidateId == nil)
    }

    @Test("submit() requires a quantity for a row or group")
    func submitRequiresQuantityForGroup() async {
        let gateway = FakePlantCandidateGateway()
        let model = makeModel(gateway: gateway)
        model.displayName = "Fig tree"
        model.groupingKind = .row

        await model.submit()

        #expect(model.errorMessage != nil)
        #expect(model.createdCandidateId == nil)
    }

    @Test("submit() succeeds with a valid individual candidate and resets the form")
    func submitSucceedsAndResets() async {
        let gateway = FakePlantCandidateGateway()
        let model = makeModel(gateway: gateway)
        model.displayName = "Fig tree"
        model.rationaleNote = "Good for the south wall"

        await model.submit()

        #expect(model.errorMessage == nil)
        #expect(model.createdCandidateId != nil)
        #expect(model.displayName == "")
        #expect(model.rationaleNote == "")
    }

    @Test("submit() surfaces a gateway failure")
    func submitSurfacesGatewayFailure() async {
        let gateway = FakePlantCandidateGateway()
        gateway.addCandidateError = APIGatewayError.unexpectedStatus(500, correlationId: "fake-failure")
        let model = makeModel(gateway: gateway)
        model.displayName = "Fig tree"

        await model.submit()

        #expect(model.errorMessage != nil)
        #expect(model.createdCandidateId == nil)
    }
}

/// A trivial `PlantGateway` stand-in — only `searchTaxonomyReferences` is
/// ever called through `SearchCandidateTaxonomyReferences` in these tests.
final class FakeCandidatePlantGateway: PlantGateway, @unchecked Sendable {
    func addPlant(gardenId: String, displayName: String, taxonomyReferenceId: String?, varietyLabel: String?, acquisitionDate: String?, acquisitionDateType: PlantAcquisitionDateType?, groupingKind: PlantGroupingKind, quantity: Int?, gardenAreaMapObjectId: String?, placementMapObjectId: String?, idempotencyKey: String) async throws -> Plant {
        fatalError("not used")
    }

    func addPlantFromPhoto(gardenId: String, photoMediaId: String, gardenAreaMapObjectId: String?, placementMapObjectId: String?, idempotencyKey: String) async throws -> Plant {
        fatalError("not used")
    }

    func getPlant(gardenId: String, plantId: String) async throws -> Plant {
        fatalError("not used")
    }

    func updatePlantDetails(gardenId: String, plantId: String, displayName: String?, taxonomyReferenceId: FieldUpdate<String>, varietyLabel: FieldUpdate<String>, acquisitionDate: FieldUpdate<String>, acquisitionDateType: FieldUpdate<PlantAcquisitionDateType>, conditionNote: FieldUpdate<String>, careGuidanceNote: FieldUpdate<String>, quantity: FieldUpdate<Int>, expectedRevision: Int, idempotencyKey: String) async throws -> Plant {
        fatalError("not used")
    }

    func attachPlantPhoto(gardenId: String, plantId: String, mediaId: String, isPrimary: Bool?, idempotencyKey: String) async throws -> PlantPhoto {
        fatalError("not used")
    }

    func setPrimaryPlantPhoto(gardenId: String, plantId: String, plantPhotoId: String, idempotencyKey: String) async throws -> PlantPhoto {
        fatalError("not used")
    }

    func confirmPlantIdentification(gardenId: String, plantId: String, identificationId: String, expectedRevision: Int, idempotencyKey: String) async throws -> Plant {
        fatalError("not used")
    }

    func getPlantIdentification(gardenId: String, plantId: String) async throws -> PlantIdentification {
        fatalError("not used")
    }

    func recordObservationFromIdentification(gardenId: String, plantId: String, identificationId: String, idempotencyKey: String) async throws -> GardenObservation {
        fatalError("not used")
    }

    func transitionLifecycleStage(gardenId: String, plantId: String, stage: PlantLifecycleStage, expectedRevision: Int, idempotencyKey: String) async throws -> Plant {
        fatalError("not used")
    }

    func setStatus(gardenId: String, plantId: String, status: PlantStatus, expectedRevision: Int, idempotencyKey: String) async throws -> Plant {
        fatalError("not used")
    }

    func movePlant(gardenId: String, plantId: String, gardenAreaMapObjectId: String?, placementMapObjectId: String?, expectedRevision: Int, idempotencyKey: String) async throws -> Plant {
        fatalError("not used")
    }

    func searchTaxonomyReferences(gardenId: String, query: String?, limit: Int?) async throws -> [TaxonomyReference] {
        []
    }

    var taxonProfileResult: Result<TaxonProfile, Error> = .failure(CancellationError())

    func getTaxonProfile(taxonomyReferenceId: String) async throws -> TaxonProfile {
        try taxonProfileResult.get()
    }

    func searchPlants(gardenId: String, query: String?, status: [PlantStatus]?, identified: Bool?, filters: PlantSearchFilters, cursor: String?, limit: Int?) async throws -> PlantSearchPage {
        fatalError("not used")
    }

    func listPlantPhotos(gardenId: String, plantId: String) async throws -> [PlantPhoto] {
        fatalError("not used")
    }
}
