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
                Picker(model.journalRecencyLabel, selection: $model.journalRecency) {
                    ForEach(JournalRecencyOption.allCases, id: \.self) { option in
                        Text(model.recencyTitle(option)).tag(option)
                    }
                }
                .accessibilityIdentifier("plants.list.journalRecencyFilter")

                Picker(model.healthConcernLabel, selection: $model.healthConcernSelection) {
                    Text(model.filterAnyTitle).tag(ImageAnalysisKind?.none)
                    ForEach(ImageAnalysisKind.allCases, id: \.self) { kind in
                        Text(model.healthConcernTitle(kind)).tag(ImageAnalysisKind?.some(kind))
                    }
                }
                .accessibilityIdentifier("plants.list.healthConcernFilter")

                Picker(model.seasonalActivityLabel, selection: $model.seasonalActivitySelection) {
                    Text(model.filterAnyTitle).tag(TaxonSeasonalActivity?.none)
                    ForEach(TaxonSeasonalActivity.allCases, id: \.self) { activity in
                        Text(model.seasonalActivityTitle(activity))
                            .tag(TaxonSeasonalActivity?.some(activity))
                    }
                }
                .accessibilityIdentifier("plants.list.seasonalActivityFilter")

                // Disabled rather than hidden: a month with no activity means
                // nothing, and a control that appears and vanishes is harder to
                // follow than one that is visibly unavailable.
                Picker(model.seasonalMonthLabel, selection: $model.seasonalMonthSelection) {
                    Text(model.filterAnyMonthTitle).tag(Int?.none)
                    ForEach(1...12, id: \.self) { month in
                        Text(model.monthTitle(month)).tag(Int?.some(month))
                    }
                }
                .disabled(model.seasonalActivitySelection == nil)
                .accessibilityIdentifier("plants.list.seasonalMonthFilter")

                Picker(model.distributionStatusLabel, selection: $model.distributionStatusSelection) {
                    Text(model.filterAnyTitle).tag(PlantDistributionStatus?.none)
                    ForEach(PlantDistributionStatus.allCases, id: \.self) { status in
                        Text(model.distributionStatusTitle(status))
                            .tag(PlantDistributionStatus?.some(status))
                    }
                }
                .accessibilityIdentifier("plants.list.distributionStatusFilter")

                TextField(model.distributionRegionLabel, text: $model.distributionRegionText)
                    .textFieldStyle(.roundedBorder)
                    .disabled(model.distributionStatusSelection == nil)
                    .accessibilityIdentifier("plants.list.distributionRegionFilter")

                Picker(
                    model.profileCompletenessLabel,
                    selection: $model.profileCompletenessSelection
                ) {
                    Text(model.filterAnyTitle).tag(PlantProfileCompleteness?.none)
                    ForEach(PlantProfileCompleteness.allCases, id: \.self) { value in
                        Text(model.profileCompletenessTitle(value))
                            .tag(PlantProfileCompleteness?.some(value))
                    }
                }
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
