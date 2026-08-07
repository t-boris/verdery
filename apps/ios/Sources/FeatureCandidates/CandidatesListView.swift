import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The candidate list's browsable content: search, status/priority filter
/// menus, and cursor-driven "Load more" pagination — mirrors
/// `FeaturePlants.PlantsListView`'s identical shape for the identical
/// problem.
struct CandidatesListView: View {
    @Bindable var model: CandidatesListViewModel
    let onSelect: (PlantCandidate) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            searchField
            filterMenus

            switch model.state {
            case .loading:
                LoadingStateView(model.loadingMessage)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("candidates.list.loading")

            case let .failed(message):
                FailureStateView(message: message, retryTitle: model.retryTitle) {
                    Task { await model.load() }
                }
                .accessibilityIdentifier("candidates.list.failure")

            case let .loaded(items, nextCursor):
                if items.isEmpty {
                    Text(model.emptyMessage)
                        .font(Typography.body)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityIdentifier("candidates.list.empty")
                } else {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        ForEach(items) { candidate in
                            Button {
                                onSelect(candidate)
                            } label: {
                                row(candidate)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("candidates.list.row.\(candidate.id)")
                        }

                        if nextCursor != nil {
                            if model.isLoadingMore {
                                LoadingStateView(model.loadingMoreMessage)
                                    .accessibilityIdentifier("candidates.list.loadingMore")
                            } else {
                                Button(model.loadMoreTitle) {
                                    Task { await model.loadMore() }
                                }
                                .accessibilityIdentifier("candidates.list.loadMore")
                            }
                        }
                    }
                }
            }
        }
        .task { await model.load() }
    }

    /// The pill that exists for exactly this. The bordered field beside a
    /// separate magnifier button was two controls where the search is one.
    private var searchField: some View {
        SearchStrip(
            accessibilityName: model.searchLabel,
            placeholder: model.searchLabel,
            clearLabel: model.closeTitle,
            query: $model.searchText,
            search: { _ in await model.load() }
        )
        .accessibilityIdentifier("candidates.list.searchField")
    }

    /// Every `PlantCandidateStatus`/`PlantCandidatePriority` is offered,
    /// nothing hidden by a fixed default — see `CandidatesListViewModel`'s
    /// own doc comment. A `Menu` of togglable rows rather than a segmented
    /// `Picker`: unlike `PlantsListView`'s single-choice `identified`
    /// filter, this is a genuine multi-select over more values than a
    /// segmented control reads well at.
    private var filterMenus: some View {
        HStack(spacing: Metrics.space2) {
            Menu {
                ForEach(PlantCandidateStatus.allCases, id: \.self) { status in
                    Button {
                        model.toggleStatus(status)
                        Task { await model.filtersDidChange() }
                    } label: {
                        Label(
                            model.statusName(status),
                            systemImage: model.selectedStatuses.contains(status) ? "checkmark" : ""
                        )
                    }
                }
            } label: {
                Label(model.statusFilterLabel, systemImage: CandidateSymbols.status)
            }
            .accessibilityIdentifier("candidates.list.statusFilter")

            Menu {
                ForEach(PlantCandidatePriority.allCases, id: \.self) { priority in
                    Button {
                        model.togglePriority(priority)
                        Task { await model.filtersDidChange() }
                    } label: {
                        Label(
                            model.priorityName(priority),
                            systemImage: model.selectedPriorities.contains(priority) ? "checkmark" : ""
                        )
                    }
                }
            } label: {
                Label(model.priorityFilterLabel, systemImage: CandidateSymbols.priority)
            }
            .accessibilityIdentifier("candidates.list.priorityFilter")
        }
    }

    private func row(_ candidate: PlantCandidate) -> some View {
        SurfaceCard {
            HStack(spacing: Metrics.space3) {
                IconMedallion(symbol: CandidateSymbols.candidate, label: candidate.displayName, tone: .neutral)
                VStack(alignment: .leading, spacing: Metrics.space1) {
                    Text(candidate.displayName)
                        .font(Typography.body.weight(.medium))
                        .foregroundStyle(Palette.text)
                    HStack(spacing: Metrics.space2) {
                        Chip(symbol: CandidateSymbols.status, label: model.statusName(candidate.status), tone: model.statusTone(candidate.status))
                        Text(model.groupingKindName(candidate.groupingKind))
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                        if let priority = candidate.priority {
                            Text(model.priorityName(priority))
                                .font(Typography.detail)
                                .foregroundStyle(Palette.textMuted)
                        }
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: CandidateSymbols.chevron)
                    .foregroundStyle(Palette.textMuted)
                    .accessibilityHidden(true)
            }
        }
    }
}
