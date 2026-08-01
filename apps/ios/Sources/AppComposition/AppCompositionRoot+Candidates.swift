import FeatureCandidates

/// The plant-candidates feature's screen factories — split from
/// `AppCompositionRoot.swift` the same way `AppCompositionRoot+Plants.swift`
/// already is, purely to keep that file under this repository's 600-line
/// rule.
extension AppCompositionRoot {
    public func makeCandidatesListViewModel(gardenId: String) -> CandidatesListViewModel {
        CandidatesListViewModel(
            gardenId: gardenId,
            listCandidates: ListCandidates(gateway: plantCandidateGateway),
            strings: strings
        )
    }

    public func makeAddCandidateViewModel(gardenId: String) -> AddCandidateViewModel {
        AddCandidateViewModel(
            gardenId: gardenId,
            addCandidate: AddCandidate(gateway: plantCandidateGateway),
            searchTaxonomyReferences: SearchCandidateTaxonomyReferences(gateway: plantGateway),
            strings: strings
        )
    }

    public func makeCandidateDetailViewModel(gardenId: String, candidateId: String) -> CandidateDetailViewModel {
        CandidateDetailViewModel(
            gardenId: gardenId,
            candidateId: candidateId,
            getCandidate: GetCandidate(gateway: plantCandidateGateway),
            updateCandidateDetails: UpdateCandidateDetails(gateway: plantCandidateGateway),
            setCandidateStatus: SetCandidateStatus(gateway: plantCandidateGateway),
            convertCandidate: ConvertCandidate(gateway: plantCandidateGateway),
            getCandidateSuitability: GetCandidateSuitability(gateway: plantCandidateGateway),
            recalculateCandidateSuitability: RecalculateCandidateSuitability(gateway: plantCandidateGateway),
            searchTaxonomyReferences: SearchCandidateTaxonomyReferences(gateway: plantGateway),
            strings: strings
        )
    }
}
