import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The plant inventory's browsable list — the primary content of the
/// "Plants" tab, backed by `PlantsListViewModel`/`SearchPlants`. Embedded
/// directly in `PlantsHomeView` rather than a separate pushed screen: this
/// tab's own root already is the list, the same "list is the tab's own
/// content, not a destination from it" shape `TasksListView`/`GardensListView`
/// already establish.
struct PlantsListView: View {
    @Bindable var model: PlantsListViewModel
    let onSelect: (Plant) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            searchField

            switch model.state {
            case .loading:
                LoadingStateView(model.loadingMessage)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("plants.list.loading")

            case let .failed(message):
                FailureStateView(message: message, retryTitle: model.retryTitle) {
                    Task { await model.load() }
                }
                .accessibilityIdentifier("plants.list.failure")

            case let .loaded(items, nextCursor):
                if items.isEmpty {
                    Text(model.emptyMessage)
                        .font(Typography.body)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityIdentifier("plants.list.empty")
                } else {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        ForEach(items) { plant in
                            Button {
                                onSelect(plant)
                            } label: {
                                row(plant)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("plants.list.row.\(plant.id)")
                        }

                        if nextCursor != nil {
                            if model.isLoadingMore {
                                LoadingStateView(model.loadingMoreMessage)
                                    .accessibilityIdentifier("plants.list.loadingMore")
                            } else {
                                Button(model.loadMoreTitle) {
                                    Task { await model.loadMore() }
                                }
                                .accessibilityIdentifier("plants.list.loadMore")
                            }
                        }
                    }
                }
            }
        }
        .task { await model.load() }
    }

    private var searchField: some View {
        HStack(spacing: Metrics.space2) {
            TextField(model.searchLabel, text: $model.searchText)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.search)
                .onSubmit { Task { await model.load() } }
                .accessibilityIdentifier("plants.list.searchField")

            Button {
                Task { await model.load() }
            } label: {
                Image(systemName: "magnifyingglass")
            }
            .accessibilityLabel(model.searchLabel)
            .accessibilityIdentifier("plants.list.searchSubmit")
        }
    }

    private func row(_ plant: Plant) -> some View {
        SurfaceCard {
            HStack(spacing: Metrics.space3) {
                IconMedallion(symbol: "leaf.fill", label: plant.displayName, tone: .neutral)
                VStack(alignment: .leading, spacing: Metrics.space1) {
                    Text(plant.displayName)
                        .font(Typography.body.weight(.medium))
                        .foregroundStyle(Palette.text)
                    if let varietyLabel = plant.varietyLabel {
                        Text(varietyLabel)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .foregroundStyle(Palette.textMuted)
                    .accessibilityHidden(true)
            }
        }
    }
}
