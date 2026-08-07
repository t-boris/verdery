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
            identifiedFilterPicker
            PlantAdvancedFiltersView(model: model)

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

    /// The pill that exists for exactly this: a leading glass, a bare field,
    /// and a clear button that appears only once there is something to clear.
    /// The bordered field beside a separate magnifier button was two controls
    /// where the search is one.
    private var searchField: some View {
        SearchStrip(
            accessibilityName: model.searchLabel,
            placeholder: model.searchLabel,
            clearLabel: model.closeTitle,
            query: $model.searchText,
            search: { _ in await model.load() }
        )
        .accessibilityIdentifier("plants.list.searchField")
    }

    /// Re-searches immediately on selection — see
    /// `PlantsListViewModel.identifiedFilterDidChange()`'s own doc comment
    /// for why this differs from `searchField`'s explicit-submit shape.
    ///
    /// A rail rather than a segmented `Picker`: the two draw the same shape,
    /// but the rail's type, tint and selected-state contrast are this
    /// application's rather than UIKit's, and it declares `isSelected` so
    /// selection is not carried by fill alone.
    private var identifiedFilterPicker: some View {
        SegmentedRail(
            fieldName: model.identifiedFilterLabel,
            options: PlantsIdentifiedFilter.allCases.map {
                SegmentedRail.Option(
                    value: $0,
                    label: model.identifiedFilterOptionTitle($0),
                    symbol: "leaf"
                )
            },
            selection: $model.identifiedFilter
        )
        .accessibilityIdentifier("plants.list.identifiedFilter")
        .onChange(of: model.identifiedFilter) {
            Task { await model.identifiedFilterDidChange() }
        }
    }

    private func row(_ plant: Plant) -> some View {
        SurfaceCard {
            HStack(spacing: Metrics.space3) {
                PlantCoverThumbnailView(
                    gardenId: plant.gardenId,
                    mediaId: plant.coverMediaId,
                    displayName: plant.displayName,
                    lifecycleStage: plant.lifecycleStage,
                    mediaGateway: model.mediaGateway
                )
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
