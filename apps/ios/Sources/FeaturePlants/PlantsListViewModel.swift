import CoreDomain
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
    public var emptyMessage: String { strings(.plantsListEmpty) }
    public var searchLabel: String { strings(.plantsListSearchLabel) }
    public var loadMoreTitle: String { strings(.plantsListLoadMore) }
    public var loadingMoreMessage: String { strings(.plantsListLoadingMore) }
    public var identifiedFilterLabel: String { strings(.plantsIdentifiedFilterLabel) }

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
