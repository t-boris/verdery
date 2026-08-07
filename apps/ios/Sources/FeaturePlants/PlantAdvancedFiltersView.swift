import CoreDesignSystem
import CoreDomain
import CoreNetworking
import SwiftUI

/// P11-SEARCH-01's six joined filters, as one collapsible section under the
/// identity picker.
///
/// COLLAPSED BY DEFAULT, for the same reason the web keeps them behind a
/// disclosure: the identity picker answers a question nearly every visit asks,
/// while these answer occasional ones, and seven permanent pickers would push
/// the list itself off a phone screen. The active count sits on the header, so
/// a filtered list is never mistaken for a garden with fewer plants.
///
/// EVERY CONTROL RE-SEARCHES ON SELECTION, matching the identity picker rather
/// than the search field: a picker selection is one discrete act, and making
/// the reader hunt for an apply button after it would be a different
/// interaction for no reason.
///
/// Source: implementation-plan.md work packages P11-SEARCH-01 and P11-IOS-01.
struct PlantAdvancedFiltersView: View {
    @Bindable var model: PlantsListViewModel
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: Metrics.space3) {
ChoiceChipGrid(
                    fieldName: model.journalRecencyLabel,
                    options: JournalRecencyOption.allCases.map {
                        ChoiceChipGrid.Option(
                            value: $0, label: model.recencyTitle($0), symbol: "clock"
                        )
                    },
                    selection: $model.journalRecency
                )
                .accessibilityIdentifier("plants.list.journalRecencyFilter")

ChoiceChipGrid(
                    fieldName: model.healthConcernLabel,
                    options: [ChoiceChipGrid.Option(
                        value: ImageAnalysisKind?.none, label: model.filterAnyTitle, symbol: "circle"
                    )] + ImageAnalysisKind.allCases.map {
                        ChoiceChipGrid.Option(
                            value: ImageAnalysisKind?.some($0),
                            label: model.healthConcernTitle($0),
                            symbol: "stethoscope"
                        )
                    },
                    selection: $model.healthConcernSelection
                )
                .accessibilityIdentifier("plants.list.healthConcernFilter")

ChoiceChipGrid(
                    fieldName: model.seasonalActivityLabel,
                    options: [ChoiceChipGrid.Option(
                        value: TaxonSeasonalActivity?.none,
                        label: model.filterAnyTitle,
                        symbol: "circle"
                    )] + TaxonSeasonalActivity.allCases.map {
                        ChoiceChipGrid.Option(
                            value: TaxonSeasonalActivity?.some($0),
                            label: model.seasonalActivityTitle($0),
                            symbol: "sun.max"
                        )
                    },
                    selection: $model.seasonalActivitySelection
                )
                .accessibilityIdentifier("plants.list.seasonalActivityFilter")

                // Disabled rather than hidden: a month with no activity means
                // nothing, and a control that appears and vanishes is harder to
                // follow than one that is visibly unavailable.
ChoiceChipGrid(
                    fieldName: model.seasonalMonthLabel,
                    options: [ChoiceChipGrid.Option(
                        value: Int?.none, label: model.filterAnyMonthTitle, symbol: "circle"
                    )] + (1...12).map {
                        ChoiceChipGrid.Option(
                            value: Int?.some($0), label: model.monthTitle($0), symbol: "calendar"
                        )
                    },
                    selection: $model.seasonalMonthSelection
                )
                .accessibilityIdentifier("plants.list.seasonalMonthFilter")
                .disabled(model.seasonalActivitySelection == nil)

ChoiceChipGrid(
                    fieldName: model.distributionStatusLabel,
                    options: [ChoiceChipGrid.Option(
                        value: PlantDistributionStatus?.none,
                        label: model.filterAnyTitle,
                        symbol: "circle"
                    )] + PlantDistributionStatus.allCases.map {
                        ChoiceChipGrid.Option(
                            value: PlantDistributionStatus?.some($0),
                            label: model.distributionStatusTitle($0),
                            symbol: "globe"
                        )
                    },
                    selection: $model.distributionStatusSelection
                )
                .accessibilityIdentifier("plants.list.distributionStatusFilter")

                ComposerField(
                    symbol: "map",
                    accessibilityName: model.distributionRegionLabel,
                    placeholder: model.distributionRegionLabel,
                    commitLabel: model.moreFiltersTitle,
                    text: $model.distributionRegionText,
                    commit: {}
                )
                .disabled(model.distributionStatusSelection == nil)
                .accessibilityIdentifier("plants.list.distributionRegionFilter")
                ChoiceChipGrid(
                    fieldName: model.profileCompletenessLabel,
                    options: [ChoiceChipGrid.Option(
                        value: PlantProfileCompleteness?.none,
                        label: model.filterAnyTitle,
                        symbol: "circle"
                    )] + PlantProfileCompleteness.allCases.map {
                        ChoiceChipGrid.Option(
                            value: PlantProfileCompleteness?.some($0),
                            label: model.profileCompletenessTitle($0),
                            symbol: "checklist"
                        )
                    },
                    selection: $model.profileCompletenessSelection
                )
                .accessibilityIdentifier("plants.list.profileCompletenessFilter")
            }
            .padding(.top, Metrics.space2)
        } label: {
            HStack(spacing: Metrics.space2) {
                Text(model.moreFiltersTitle)
                if model.activeFilterCount > 0 {
                    Text(String(model.activeFilterCount))
                        .font(Typography.detail)
                        .padding(.horizontal, Metrics.space2)
                        .background(Capsule().fill(.tint.opacity(0.15)))
                        .accessibilityLabel(model.activeFilterCountLabel)
                }
            }
        }
        .accessibilityIdentifier("plants.list.moreFilters")
        .onChange(of: model.filters) {
            Task { await model.filtersDidChange() }
        }
    }
}
