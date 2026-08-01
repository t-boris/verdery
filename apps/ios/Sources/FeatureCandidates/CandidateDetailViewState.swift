import CoreDomain

/// The detail screen's own load state — mirrors
/// `FeaturePlants.PlantDetailViewState`'s identical shape. Unlike that
/// type, `.loaded` carries the raw `PlantCandidate` directly rather than a
/// projected summary: nothing here needs localization-independent derived
/// fields the way a plant's identification banner does.
public enum CandidateDetailViewState: Equatable, Sendable {
    case loading
    case loaded(PlantCandidate)
    case failed(message: String)
}
