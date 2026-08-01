import CoreDesignSystem
import CoreDomain
import CoreLocalization
import CoreNetworking
import Observation

/// View model for the candidate list: search, status/priority filters, and
/// cursor-driven "Load more" pagination — mirrors
/// `FeaturePlants.PlantsListViewModel`'s identical shape for the identical
/// problem.
///
/// The status filter starts at `workingStatuses` — everything except
/// `.archived` and `.rejected` — so disposing of a candidate takes it out of
/// the list, which is what a user who just archived one expects. This
/// defaulted to every status on the reasoning that browsing disposed
/// candidates is useful; it is, but not unasked, and an archived candidate
/// that stays put reads as an archive that did not work. Both remain one tap
/// away in the filter, `PlantsListViewModel` hides its own `.removed` plants
/// for the same reason, and `apps/web/features/candidates/candidate-list.tsx`
/// makes the identical choice. An empty PRIORITY selection still means
/// "every value."
///
/// Source: implementation-plan.md work package P11-IOS-01;
/// packages/api-contracts/openapi.yaml, operation `listCandidates`.
@MainActor
@Observable
public final class CandidatesListViewModel {
    public private(set) var state: CandidatesListViewState = .loading
    public private(set) var isLoadingMore = false
    /// Applied only on the next `load()` — the same explicit-submit shape
    /// `PlantsListViewModel.searchText` uses.
    public var searchText: String = ""
    public var selectedStatuses: Set<PlantCandidateStatus> = CandidatesListViewModel.workingStatuses

    /// The statuses a candidate is still being worked on under — the default view.
    public static let workingStatuses: Set<PlantCandidateStatus> = [.active, .converted]
    public var selectedPriorities: Set<PlantCandidatePriority> = []

    public let gardenId: String
    private let listCandidates: ListCandidates
    private let strings: LocalizedStrings

    public init(gardenId: String, listCandidates: ListCandidates, strings: LocalizedStrings) {
        self.gardenId = gardenId
        self.listCandidates = listCandidates
        self.strings = strings
    }

    public var title: String { strings(.candidatesTitle) }
    public var description: String { strings(.candidatesDescription) }
    public var searchLabel: String { strings(.candidatesSearchLabel) }
    public var statusFilterLabel: String { strings(.candidatesFilterStatusLabel) }
    public var priorityFilterLabel: String { strings(.candidatesFilterPriorityLabel) }
    public var loadingMessage: String { strings(.candidatesLoading) }
    public var loadingMoreMessage: String { strings(.candidatesLoadingMore) }
    public var retryTitle: String { strings(.candidatesRetry) }
    public var emptyMessage: String { strings(.candidatesEmpty) }
    public var loadMoreTitle: String { strings(.candidatesLoadMore) }
    public var addButtonTitle: String { strings(.candidatesAddButtonTitle) }

    public func statusName(_ status: PlantCandidateStatus) -> String {
        CandidatesLocalization.statusName(status, strings: strings)
    }

    public func statusTone(_ status: PlantCandidateStatus) -> Tone {
        CandidatesLocalization.tone(for: status)
    }

    public func priorityName(_ priority: PlantCandidatePriority) -> String {
        CandidatesLocalization.priorityName(priority, strings: strings)
    }

    public func groupingKindName(_ kind: PlantGroupingKind) -> String {
        CandidatesLocalization.groupingKindName(kind, strings: strings)
    }

    private var trimmedQuery: String? {
        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public func toggleStatus(_ status: PlantCandidateStatus) {
        if selectedStatuses.contains(status) {
            selectedStatuses.remove(status)
        } else {
            selectedStatuses.insert(status)
        }
    }

    public func togglePriority(_ priority: PlantCandidatePriority) {
        if selectedPriorities.contains(priority) {
            selectedPriorities.remove(priority)
        } else {
            selectedPriorities.insert(priority)
        }
    }

    /// A filter change re-searches immediately — a checkbox toggle is a
    /// single discrete action, not per-keystroke typing, the same
    /// reasoning `FeaturePlants.PlantsListViewModel
    /// .identifiedFilterDidChange()`'s own doc comment gives for its own
    /// identically-shaped filter.
    public func filtersDidChange() async {
        await load()
    }

    public func load() async {
        state = .loading
        do {
            let page = try await listCandidates(
                gardenId: gardenId,
                query: trimmedQuery,
                status: selectedStatuses.isEmpty ? nil : Array(selectedStatuses),
                priority: selectedPriorities.isEmpty ? nil : Array(selectedPriorities)
            )
            state = .loaded(items: page.items, nextCursor: page.nextCursor)
        } catch let error as APIGatewayError {
            state = .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    public func loadMore() async {
        guard case let .loaded(items, nextCursor) = state, let nextCursor, !isLoadingMore else { return }

        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let page = try await listCandidates(
                gardenId: gardenId,
                query: trimmedQuery,
                status: selectedStatuses.isEmpty ? nil : Array(selectedStatuses),
                priority: selectedPriorities.isEmpty ? nil : Array(selectedPriorities),
                cursor: nextCursor
            )
            state = .loaded(items: items + page.items, nextCursor: page.nextCursor)
        } catch {
            // A failed "load more" leaves the already-loaded page displayed
            // rather than replacing it with a full failure state — the same
            // "existing data stays visible" rule `PlantsListViewModel
            // .loadMore()` already follows.
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
