import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureCandidates

@MainActor
@Suite("Candidate detail view model")
struct CandidateDetailViewModelTests {
    private func candidate(
        id: String = "candidate-1",
        status: PlantCandidateStatus = .active,
        groupingKind: PlantGroupingKind = .individual,
        revision: Int = 1
    ) -> PlantCandidate {
        PlantCandidate(
            id: id, gardenId: "garden-1", proposedGardenAreaMapObjectId: nil,
            proposedPlacementMapObjectId: nil, displayName: "Fig tree", taxonomyReferenceId: nil,
            varietyLabel: nil, groupingKind: groupingKind, quantity: groupingKind == .individual ? nil : 3,
            status: status, rationaleNote: nil, priority: nil, priceAmount: nil, priceCurrency: nil,
            purchaseSource: nil, alternativeToCandidateId: nil, revision: revision,
            createdByProfileId: "profile-1", createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func makeModel(
        gateway: FakePlantCandidateGateway,
        candidateId: String = "candidate-1"
    ) -> CandidateDetailViewModel {
        CandidateDetailViewModel(
            gardenId: "garden-1",
            candidateId: candidateId,
            getCandidate: GetCandidate(gateway: gateway),
            updateCandidateDetails: UpdateCandidateDetails(gateway: gateway),
            setCandidateStatus: SetCandidateStatus(gateway: gateway),
            convertCandidate: ConvertCandidate(gateway: gateway),
            getCandidateSuitability: GetCandidateSuitability(gateway: gateway),
            recalculateCandidateSuitability: RecalculateCandidateSuitability(gateway: gateway),
            searchTaxonomyReferences: SearchCandidateTaxonomyReferences(gateway: FakeCandidatePlantGateway()),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    @Test("load() populates the edit form and loads suitability, folding a 404 into nil")
    func loadPopulatesFormAndSuitability() async {
        let gateway = FakePlantCandidateGateway(candidates: [candidate()])
        let model = makeModel(gateway: gateway)

        await model.load()

        guard case .loaded = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(model.displayName == "Fig tree")
        #expect(model.suitability == nil)
        #expect(model.suitabilityErrorMessage == nil)
    }

    @Test("saveDetails() persists the edited display name")
    func saveDetailsPersistsDisplayName() async {
        let gateway = FakePlantCandidateGateway(candidates: [candidate()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.displayName = "Fig tree (renamed)"
        await model.saveDetails()

        #expect(model.detailsErrorMessage == nil)
        #expect(model.detailsSaved)
        guard case let .loaded(updated) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(updated.displayName == "Fig tree (renamed)")
    }

    @Test("saveDetails() rejects an empty display name without calling the gateway")
    func saveDetailsRejectsEmptyName() async {
        let gateway = FakePlantCandidateGateway(candidates: [candidate()])
        let model = makeModel(gateway: gateway)
        await model.load()

        model.displayName = "   "
        await model.saveDetails()

        #expect(model.detailsErrorMessage != nil)
    }

    @Test("saveStatus() never offers .converted and persists the new status")
    func saveStatusPersists() async {
        let gateway = FakePlantCandidateGateway(candidates: [candidate()])
        let model = makeModel(gateway: gateway)
        await model.load()

        #expect(CandidateDetailViewModel.settableStatuses.contains(.converted) == false)

        model.selectedStatus = .rejected
        await model.saveStatus()

        #expect(model.statusErrorMessage == nil)
        #expect(model.statusSaved)
        guard case let .loaded(updated) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(updated.status == .rejected)
    }

    @Test("recalculateSuitability() populates the assessment")
    func recalculateSuitabilityPopulates() async {
        let gateway = FakePlantCandidateGateway(candidates: [candidate()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.recalculateSuitability()

        #expect(model.suitability != nil)
        #expect(model.suitabilityErrorMessage == nil)
    }

    @Test("convert() marks the candidate converted and exposes the new plant id")
    func convertMarksConverted() async {
        let gateway = FakePlantCandidateGateway(candidates: [candidate()])
        let model = makeModel(gateway: gateway)
        await model.load()

        await model.convert()

        #expect(model.convertErrorMessage == nil)
        #expect(model.convertedPlantId != nil)
        guard case let .loaded(updated) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(updated.status == .converted)
    }

    @Test("every mutating action refuses locally once already converted")
    func mutationsRefuseOnceConverted() async {
        let gateway = FakePlantCandidateGateway(candidates: [candidate(status: .converted)])
        let model = makeModel(gateway: gateway)
        await model.load()

        #expect(model.isConverted)

        model.displayName = "Renamed"
        await model.saveDetails()
        #expect(model.detailsErrorMessage == model.alreadyConvertedMessage)

        await model.saveStatus()
        #expect(model.statusErrorMessage == model.alreadyConvertedMessage)

        await model.convert()
        #expect(model.convertErrorMessage == model.alreadyConvertedMessage)
    }
}
