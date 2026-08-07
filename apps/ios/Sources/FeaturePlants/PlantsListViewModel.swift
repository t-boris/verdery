import CoreDomain
import Foundation
import CoreLocalization
import CoreNetworking
import Observation

/// The list's own `identified` filter — three states over `SearchPlants`'s
/// nullable `identified: Bool?` parameter (P11-SEARCH-01), mirroring the web
/// client's own identical `IdentifiedFilter` in `plant-list.tsx`.
public enum PlantsIdentifiedFilter: String, CaseIterable, Equatable, Sendable {
    case all
    case identified
    case unidentified

    var queryValue: Bool? {
        switch self {
        case .all: nil
        case .identified: true
        case .unidentified: false
        }
    }
}

/// The list's own load state — a plain enum, the same shape
/// `TasksListViewState`/`GardensListViewState` already establish. `loaded`
/// carries `nextCursor` alongside the rows: `nil` once the last page has
/// been reached, driving whether `PlantsListView` shows a "Load more" row.
public enum PlantsListViewState: Equatable {
    case loading
    case loaded(items: [Plant], nextCursor: String?)
    case failed(message: String)
}

/// View model for the plant inventory's browsable list, backed by
/// `SearchPlants`. A manual "Load more" button over `nextCursor`, not
/// infinite scroll — matches the web client's own `plant-list.tsx`
/// precedent; there is no other cursor-driven list anywhere in this app to
/// mirror instead (`GardensListViewModel`/`TasksListViewModel` both only
/// ever fetch a single unfiltered page and merge it with a local store,
/// which a plant search has no equivalent of).
///
/// No local caching: unlike a single plant's own detail screen, a search
/// result page has nothing meaningful to show offline (there is no local
/// index of every plant in the garden) — the same choice
/// `SearchTaxonomyReferences`'s own picker already makes.
///
/// Source: implementation-plan.md work package P4-IOS-01;
/// packages/api-contracts/openapi.yaml, operation `searchPlants`.
@MainActor
@Observable
public final class PlantsListViewModel {
    public private(set) var state: PlantsListViewState = .loading
    public private(set) var isLoadingMore = false
    /// Applied only on the next `load()` — changing this while a list is
    /// already showing does not re-search until the reader submits, the
    /// same explicit-submit shape `TaxonomyReferencePickerView`'s own search
    /// field uses, rather than a per-keystroke network call.
    public var searchText: String = ""
    /// Unlike `searchText`, applying this immediately re-searches — see
    /// `identifiedFilterDidChange()`, called from the view's `Picker`
    /// `onChange`. A picker selection is a single discrete action, not
    /// per-keystroke typing, so there is no reason to defer it to a manual
    /// submit the way free-text search is.
    public var identifiedFilter: PlantsIdentifiedFilter = .all

    private let searchPlants: SearchPlants
    private let strings: LocalizedStrings
    public let gardenId: String
    /// Resolves each row's `Plant.coverMediaId` to a signed thumbnail URL —
    /// see `PlantCoverThumbnailView`'s own doc comment. Optional-capability:
    /// `nil` at a call site (e.g. a test double with no media capability)
    /// just means every row falls back to its lifecycle-stage icon.
    public let mediaGateway: (any MediaGateway)?

    public init(
        gardenId: String,
        searchPlants: SearchPlants,
        strings: LocalizedStrings,
        mediaGateway: (any MediaGateway)? = nil
    ) {
        self.gardenId = gardenId
        self.searchPlants = searchPlants
        self.strings = strings
        self.mediaGateway = mediaGateway
    }

    public var loadingMessage: String { strings(.plantsListLoading) }
    public var retryTitle: String { strings(.plantsListRetry) }
    public var closeTitle: String { strings(.plantsClose) }
    public var emptyMessage: String { strings(.plantsListEmpty) }
    public var searchLabel: String { strings(.plantsListSearchLabel) }
    public var loadMoreTitle: String { strings(.plantsListLoadMore) }
    public var loadingMoreMessage: String { strings(.plantsListLoadingMore) }
    public var identifiedFilterLabel: String { strings(.plantsIdentifiedFilterLabel) }
    public var filterAnyTitle: String { strings(.plantsFilterAny) }
    public var filterAnyMonthTitle: String { strings(.plantsFilterAnyMonth) }
    public var journalRecencyLabel: String { strings(.plantsJournalRecencyLabel) }
    public var healthConcernLabel: String { strings(.plantsHealthConcernLabel) }
    public var seasonalActivityLabel: String { strings(.plantsSeasonalActivityLabel) }
    public var seasonalMonthLabel: String { strings(.plantsSeasonalMonthLabel) }
    public var distributionStatusLabel: String { strings(.plantsDistributionStatusLabel) }
    public var distributionRegionLabel: String { strings(.plantsDistributionRegionLabel) }
    public var profileCompletenessLabel: String { strings(.plantsProfileCompletenessLabel) }

    public var moreFiltersTitle: String { strings(.plantsMoreFilters) }

    /// Single-selection bindings over the API's list-valued filters.
    ///
    /// The contract takes lists so a caller CAN ask for two concerns at once,
    /// but a phone-sized picker that offers multi-select for four values costs
    /// more interaction than it saves. One value or none covers what a reader
    /// actually asks, and the list shape stays available to any caller that
    /// needs it.
    public var healthConcernSelection: ImageAnalysisKind? {
        get { filters.healthConcern.first }
        set { filters.healthConcern = newValue.map { [$0] } ?? [] }
    }

    public var seasonalActivitySelection: TaxonSeasonalActivity? {
        get { filters.seasonalActivity.first }
        set {
            filters.seasonalActivity = newValue.map { [$0] } ?? []
            // A month without an activity filters nothing; clearing it here
            // stops a stale month sitting in a disabled control.
            if newValue == nil { filters.seasonalMonth = nil }
        }
    }

    public var seasonalMonthSelection: Int? {
        get { filters.seasonalMonth }
        set { filters.seasonalMonth = newValue }
    }

    public var distributionStatusSelection: PlantDistributionStatus? {
        get { filters.distributionStatus.first }
        set {
            filters.distributionStatus = newValue.map { [$0] } ?? []
            if newValue == nil { filters.distributionRegion = nil }
        }
    }

    public var distributionRegionText: String {
        get { filters.distributionRegion ?? "" }
        set { filters.distributionRegion = newValue.isEmpty ? nil : newValue }
    }

    public var profileCompletenessSelection: PlantProfileCompleteness? {
        get { filters.profileCompleteness }
        set { filters.profileCompleteness = newValue }
    }

    public var activeFilterCountLabel: String { strings(.plantsMoreFilters) }

    public func healthConcernTitle(_ kind: ImageAnalysisKind) -> String {
        switch kind {
        case .stress: strings(.plantsHealthStress)
        case .disease: strings(.plantsHealthDisease)
        case .pest: strings(.plantsHealthPest)
        case .other: strings(.plantsHealthOther)
        }
    }

    public func seasonalActivityTitle(_ activity: TaxonSeasonalActivity) -> String {
        switch activity {
        case .sowIndoors: strings(.plantsSeasonSowIndoors)
        case .sowOutdoors: strings(.plantsSeasonSowOutdoors)
        case .transplant: strings(.plantsSeasonTransplant)
        case .harvest: strings(.plantsSeasonHarvest)
        }
    }

    public func distributionStatusTitle(_ status: PlantDistributionStatus) -> String {
        switch status {
        case .native: strings(.plantsDistributionNative)
        case .introduced: strings(.plantsDistributionIntroduced)
        case .invasive: strings(.plantsDistributionInvasive)
        case .regulated: strings(.plantsDistributionRegulated)
        }
    }

    public func profileCompletenessTitle(_ value: PlantProfileCompleteness) -> String {
        switch value {
        case .complete: strings(.plantsCompletenessComplete)
        case .partial: strings(.plantsCompletenessPartial)
        case .none: strings(.plantsCompletenessNone)
        }
    }

    /// The device's own month names — a hand-maintained list of twelve
    /// translations per locale would drift, and Foundation already has them.
    public func monthTitle(_ month: Int) -> String {
        let symbols = Calendar.current.monthSymbols
        guard month >= 1, month <= symbols.count else { return String(month) }
        return symbols[month - 1]
    }

    public func recencyTitle(_ option: JournalRecencyOption) -> String {
        switch option {
        case .any: strings(.plantsFilterAny)
        case .seen7: strings(.plantsRecencySeen7)
        case .seen30: strings(.plantsRecencySeen30)
        case .notSeen30: strings(.plantsRecencyNotSeen30)
        case .notSeen90: strings(.plantsRecencyNotSeen90)
        case .neverSeen: strings(.plantsRecencyNeverSeen)
        }
    }

    /// The single recency control, mapped to at most one of the API's two
    /// independent bounds. A reader wants "recently seen" OR "neglected";
    /// setting both returns nothing and reads as a bug.
    public var journalRecency: JournalRecencyOption {
        get {
            if filters.observedWithinDays == 7 { return .seen7 }
            if filters.observedWithinDays == 30 { return .seen30 }
            if filters.notObservedForDays == 30 { return .notSeen30 }
            if filters.notObservedForDays == 90 { return .notSeen90 }
            if filters.notObservedForDays == JournalRecencyOption.neverSeenDays { return .neverSeen }
            return .any
        }
        set {
            filters.observedWithinDays = newValue.observedWithinDays
            filters.notObservedForDays = newValue.notObservedForDays
        }
    }

    public func identifiedFilterOptionTitle(_ filter: PlantsIdentifiedFilter) -> String {
        switch filter {
        case .all: strings(.plantsIdentifiedFilterAll)
        case .identified: strings(.plantsIdentifiedFilterIdentified)
        case .unidentified: strings(.plantsIdentifiedFilterUnidentified)
        }
    }

    private var trimmedQuery: String? {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Every status except `removed` — there is no filter UI yet (a
    /// deliberate, documented scope call, `docs/development/
    /// deferred-capabilities.md`), so the one thing this list must not do by
    /// default is keep showing a plant the reader just deleted
    /// (`SetPlantStatus('removed')`, `PlantDetailViewModel.delete()`) as if
    /// nothing happened.
    private static let visibleStatuses: [PlantStatus] = PlantStatus.allCases.filter { $0 != .removed }

    /// P11-SEARCH-01's joined filters, as one value the view binds to and the
    /// two search calls below both read. Held whole rather than as eight
    /// properties so that adding a filter does not mean touching both calls
    /// and every test that constructs this model.
    public var filters: PlantSearchFilters = .none

    /// How many joined filters are narrowing the result — the view shows this
    /// so a filtered list is never mistaken for a garden with fewer plants.
    public var activeFilterCount: Int {
        [
            filters.observedWithinDays != nil || filters.notObservedForDays != nil,
            !filters.healthConcern.isEmpty,
            !filters.seasonalActivity.isEmpty,
            !filters.distributionStatus.isEmpty,
            !(filters.distributionRegion?.trimmingCharacters(in: .whitespaces).isEmpty ?? true),
            filters.profileCompleteness != nil,
        ].filter { $0 }.count
    }

    public func load() async {
        state = .loading
        do {
            let page = try await searchPlants(
                gardenId: gardenId,
                query: trimmedQuery,
                status: Self.visibleStatuses,
                identified: identifiedFilter.queryValue,
                filters: filters
            )
            state = .loaded(items: page.items, nextCursor: page.nextCursor)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    /// A `Picker` selection is a single discrete action — re-searches
    /// immediately, unlike free-text `searchText`'s explicit-submit shape.
    public func identifiedFilterDidChange() async {
        await load()
    }

    /// Re-searches from the first page. A cursor encodes a position in the
    /// PREVIOUS result set; carrying it into a narrower one skips rows that
    /// now belong on page one, so `load()` is the only correct response to a
    /// filter change.
    public func filtersDidChange() async {
        await load()
    }

    public func loadMore() async {
        guard case let .loaded(items, nextCursor) = state, let nextCursor, !isLoadingMore else { return }

        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let page = try await searchPlants(
                gardenId: gardenId,
                query: trimmedQuery,
                status: Self.visibleStatuses,
                identified: identifiedFilter.queryValue,
                filters: filters,
                cursor: nextCursor
            )
            state = .loaded(items: items + page.items, nextCursor: page.nextCursor)
        } catch {
            // A failed "load more" leaves the already-loaded page displayed
            // rather than replacing it with a full failure state — the same
            // "existing data stays visible" rule this codebase's own online-
            // first architecture doc establishes for background refreshes.
        }
    }

    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }
}
