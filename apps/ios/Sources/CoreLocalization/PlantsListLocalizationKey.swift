/// Keys the browsable plant-inventory list screen resolves against the
/// localization catalogue.
///
/// A second enum for `FeaturePlants` rather than more cases in
/// ``LocalizationKey`` — the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum PlantsListLocalizationKey: String, Sendable, CaseIterable {
    case plantsListLoading = "plants.list.loading"
    case plantsListRetry = "plants.list.retry"
    case plantsListEmpty = "plants.list.empty"
    case plantsListSearchLabel = "plants.list.searchLabel"
    case plantsListLoadMore = "plants.list.loadMore"
    case plantsListLoadingMore = "plants.list.loadingMore"
}
