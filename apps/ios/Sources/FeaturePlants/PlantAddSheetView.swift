import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The add-a-plant sheet.
///
/// Extracted from `PlantsHomeView`'s thirteen-row `Form` section. Grouping
/// kind and acquisition-date type became chip rows led by their own symbols —
/// a row of three shapes rather than a `Picker` that has to be opened to see
/// what is in it — and the optional groups (quantity, acquisition date,
/// placement) stay collapsed until they are wanted.
///
/// The display-name field takes focus on appear, and submission is blocked
/// while the name is empty rather than accepted and refused afterwards.
struct PlantAddSheetView: View {
    @Bindable var model: PlantsHomeViewModel
    let onCancel: () -> Void
    let onFinish: (Bool) -> Void

    @FocusState private var isDisplayNameFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    identitySection
                    groupingSection
                    acquisitionSection
                    placementSection

                    if let message = model.errorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("plants.add.failure")
                    }

                    Button(action: submit) {
                        Label(model.addSubmitTitle, systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSubmitDisabled)
                    .accessibilityIdentifier("plants.add.submit")
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.addSectionTitle)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle, action: onCancel)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(model.closeTitle) { isDisplayNameFocused = false }
                }
            }
            .onAppear { isDisplayNameFocused = true }
            .sheet(isPresented: $model.isTaxonomyPickerPresented) {
                TaxonomyReferencePickerView(
                    title: model.taxonomyPickerTitle,
                    searchLabel: model.taxonomyPickerSearchLabel,
                    emptyMessage: model.taxonomyPickerEmptyMessage,
                    closeTitle: model.closeTitle,
                    displayName: { model.taxonomyDisplayName($0) },
                    search: { await model.searchTaxonomy(query: $0) },
                    onSelect: { model.selectTaxonomy($0) },
                    onClose: { model.isTaxonomyPickerPresented = false }
                )
            }
        }
    }

    private var identitySection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "leaf", title: model.displayNameLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.displayNameLabel, text: $model.displayName)
                        .textFieldStyle(.roundedBorder)
                        .focused($isDisplayNameFocused)
                        .accessibilityIdentifier("plants.add.displayNameField")

                    TextField(model.varietyLabelLabel, text: $model.varietyLabel)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("plants.add.varietyLabelField")

                    taxonomyRow
                }
            }
        }
    }

    private var taxonomyRow: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button {
                model.isTaxonomyPickerPresented = true
            } label: {
                HStack(spacing: Metrics.space2) {
                    Image(systemName: PlantSymbols.taxonomy)
                        .foregroundStyle(Palette.accent)
                        .accessibilityHidden(true)
                    Text(model.taxonomyLabel)
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Text(model.selectedTaxonomySummary)
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plants.add.taxonomyRow")

            if model.selectedTaxonomyReference != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .font(Typography.detail)
                    .tint(Palette.negative)
                    .accessibilityIdentifier("plants.add.taxonomyClear")
            }
        }
    }

    private var groupingSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "square.grid.2x2", title: model.groupingKindLabel)

            HStack(spacing: Metrics.space2) {
                ForEach(PlantGroupingKind.allCases, id: \.self) { kind in
                    PlantChoiceChip(
                        symbol: PlantSymbols.groupingKind(kind),
                        label: model.groupingKindName(kind),
                        isSelected: model.groupingKind == kind
                    ) {
                        model.groupingKind = kind
                    }
                }
                Spacer(minLength: 0)
            }
            .accessibilityIdentifier("plants.add.groupingKindPicker")

            if model.groupingKind != .individual {
                SurfaceCard {
                    HStack(spacing: Metrics.space2) {
                        Image(systemName: PlantSymbols.quantity)
                            .foregroundStyle(Palette.textMuted)
                            .accessibilityHidden(true)
                        TextField(model.quantityLabel, text: $model.quantityText)
                            .textFieldStyle(.roundedBorder)
                            #if os(iOS)
                                .keyboardType(.numberPad)
                            #endif
                            .accessibilityIdentifier("plants.add.quantityField")
                    }
                }
            }
        }
    }

    private var acquisitionSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "calendar", title: model.acquisitionDateLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Toggle(model.acquisitionDateToggleLabel, isOn: $model.hasAcquisitionDate)
                        .accessibilityIdentifier("plants.add.acquisitionDateToggle")

                    if model.hasAcquisitionDate {
                        DatePicker(
                            model.acquisitionDateLabel,
                            selection: $model.acquisitionDate,
                            displayedComponents: .date
                        )
                        .accessibilityIdentifier("plants.add.acquisitionDatePicker")

                        HStack(spacing: Metrics.space2) {
                            ForEach(PlantAcquisitionDateType.allCases, id: \.self) { type in
                                PlantChoiceChip(
                                    symbol: PlantSymbols.acquisitionDateType(type),
                                    label: model.acquisitionDateTypeName(type),
                                    isSelected: model.acquisitionDateType == type
                                ) {
                                    model.acquisitionDateType = type
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .accessibilityIdentifier("plants.add.acquisitionDateTypePicker")
                    }
                }
            }
            .tint(Palette.accent)
        }
    }

    private var placementSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: PlantSymbols.placement, title: model.placementLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    TextField(model.gardenAreaLabel, text: $model.gardenAreaMapObjectId)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("plants.add.gardenAreaField")
                    TextField(model.placementLabel, text: $model.placementMapObjectId)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("plants.add.placementField")
                    InlineMessage(model.mapObjectIdHint, tone: .info)
                }
            }
        }
    }

    private var isSubmitDisabled: Bool {
        model.state == .submitting
            || model.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit() {
        guard !isSubmitDisabled else { return }

        Task {
            await model.submitAddPlant()
            onFinish(model.errorMessage == nil)
        }
    }
}

/// A chip that is also a single-choice control.
///
/// The selected chip is outlined as well as filled and declares the
/// `isSelected` trait, so the choice is never carried by colour alone and
/// VoiceOver announces which one is active.
struct PlantChoiceChip: View {
    let symbol: String
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button {
            action()
            Haptics.play(.selection)
        } label: {
            Chip(symbol: symbol, label: label, tone: isSelected ? .accent : .neutral)
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(
                            isSelected ? Palette.accent : Color.clear,
                            lineWidth: Metrics.hairline
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
