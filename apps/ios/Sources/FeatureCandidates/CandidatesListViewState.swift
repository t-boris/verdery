import CoreDomain

/// The list's own load state — mirrors `FeaturePlants.PlantsListViewState`'s
/// identical shape for the identical "cursor-paginated search" problem.
public enum CandidatesListViewState: Equatable {
    case loading
    case loaded(items: [PlantCandidate], nextCursor: String?)
    case failed(message: String)
}
