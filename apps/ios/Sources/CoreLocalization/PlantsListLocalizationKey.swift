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
    case plantsIdentifiedFilterLabel = "plants.identifiedFilter.label"
    case plantsIdentifiedFilterAll = "plants.identifiedFilter.all"
    case plantsIdentifiedFilterIdentified = "plants.identifiedFilter.identified"
    case plantsIdentifiedFilterUnidentified = "plants.identifiedFilter.unidentified"

    case plantsMoreFilters = "plants.filters.more"
    case plantsFilterAny = "plants.filters.any"
    case plantsFilterAnyMonth = "plants.filters.anyMonth"
    case plantsJournalRecencyLabel = "plants.filters.journalRecency"
    case plantsRecencySeen7 = "plants.filters.recency.seen7"
    case plantsRecencySeen30 = "plants.filters.recency.seen30"
    case plantsRecencyNotSeen30 = "plants.filters.recency.notSeen30"
    case plantsRecencyNotSeen90 = "plants.filters.recency.notSeen90"
    case plantsRecencyNeverSeen = "plants.filters.recency.neverSeen"
    case plantsHealthConcernLabel = "plants.filters.healthConcern"
    case plantsSeasonalActivityLabel = "plants.filters.seasonalActivity"
    case plantsSeasonalMonthLabel = "plants.filters.seasonalMonth"
    case plantsDistributionStatusLabel = "plants.filters.distributionStatus"
    case plantsDistributionRegionLabel = "plants.filters.distributionRegion"
    case plantsProfileCompletenessLabel = "plants.filters.profileCompleteness"
    case plantsHealthStress = "plants.filters.health.stress"
    case plantsHealthDisease = "plants.filters.health.disease"
    case plantsHealthPest = "plants.filters.health.pest"
    case plantsHealthOther = "plants.filters.health.other"
    case plantsSeasonSowIndoors = "plants.filters.season.sowIndoors"
    case plantsSeasonSowOutdoors = "plants.filters.season.sowOutdoors"
    case plantsSeasonTransplant = "plants.filters.season.transplant"
    case plantsSeasonHarvest = "plants.filters.season.harvest"
    case plantsDistributionNative = "plants.filters.distribution.native"
    case plantsDistributionIntroduced = "plants.filters.distribution.introduced"
    case plantsDistributionInvasive = "plants.filters.distribution.invasive"
    case plantsDistributionRegulated = "plants.filters.distribution.regulated"
    case plantsCompletenessComplete = "plants.filters.completeness.complete"
    case plantsCompletenessPartial = "plants.filters.completeness.partial"
    case plantsCompletenessNone = "plants.filters.completeness.none"

    /// `MeasureField`'s two accessible adjust actions. A drag gesture with no
    /// spoken equivalent is a control that does not exist for a VoiceOver
    /// reader, so the component requires both names rather than defaulting them.
    case plantsQuantityIncrease = "plants.quantity.increase"
    case plantsQuantityDecrease = "plants.quantity.decrease"
    case plantsQuantityUnit = "plants.quantity.unit"
}
