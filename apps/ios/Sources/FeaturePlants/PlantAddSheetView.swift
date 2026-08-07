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
            .sheet(isPresented: mapObjectPickerPresented) {
                MapObjectPickerView(
                    title: model.mapObjectPickerTitle,
                    clearTitle: model.mapObjectPickerClearTitle,
                    closeTitle: model.closeTitle,
                    emptyMessage: model.mapObjectPickerEmptyMessage,
                    objects: model.mapObjects,
                    onSelect: { model.selectMapObject($0) },
                    onClose: { model.activeMapObjectField = nil }
                )
            }
        }
    }

    private var mapObjectPickerPresented: Binding<Bool> {
        Binding(
            get: { model.activeMapObjectField != nil },
            set: { if !$0 { model.activeMapObjectField = nil } }
        )
    }

    private var identitySection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "leaf", title: model.displayNameLabel)

            VStack(alignment: .leading, spacing: Metrics.space3) {
                ComposerField(
                    symbol: "leaf",
                    accessibilityName: model.displayNameLabel,
                    placeholder: model.displayNameLabel,
                    commitLabel: model.addSubmitTitle,
                    text: $model.displayName,
                    commit: submit
                )
                .accessibilityIdentifier("plants.add.displayNameField")

                ComposerField(
                    symbol: "tag",
                    accessibilityName: model.varietyLabelLabel,
                    placeholder: model.varietyLabelLabel,
                    commitLabel: model.addSubmitTitle,
                    text: $model.varietyLabel,
                    commit: submit
                )
                .accessibilityIdentifier("plants.add.varietyLabelField")

                SurfaceCard { taxonomyRow }
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
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                    Text(model.taxonomyLabel)
                        .font(FieldConsoleType.body.font)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Text(model.selectedTaxonomySummary)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plants.add.taxonomyRow")

            if model.selectedTaxonomyReference != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .font(FieldConsoleType.detail.font)
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
                // A count is a numeral you nudge, not a sentence you type: the
                // drag moves it by one with a tick per step, and the keypad is
                // still there for "forty-three".
                MeasureField(
                    fieldName: model.quantityLabel,
                    unitLabel: model.quantityUnitLabel,
                    decreaseLabel: model.quantityDecreaseLabel,
                    increaseLabel: model.quantityIncreaseLabel,
                    value: quantityBinding,
                    step: 1,
                    range: 1...9_999,
                    fractionDigits: 0,
                    locale: .autoupdatingCurrent
                )
                .accessibilityIdentifier("plants.add.quantityField")
            }
        }
    }

    private var acquisitionSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "calendar", title: model.acquisitionDateLabel)

            OptionalValueCard(
                fieldName: model.acquisitionDateLabel,
                addPrompt: model.acquisitionDateToggleLabel,
                clearLabel: model.closeTitle,
                symbol: "calendar",
                displayValue: model.hasAcquisitionDate
                    ? CalendarText.day(model.acquisitionDate) : nil,
                clear: { model.hasAcquisitionDate = false }
            ) {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    DateDial(
                        fieldName: model.acquisitionDateLabel,
                        selection: $model.acquisitionDate,
                        now: .now,
                        calendar: .current,
                        chipTitle: model.relativeDayTitle,
                        dayNumber: CalendarText.dayNumber,
                        weekdayName: CalendarText.weekday,
                        longDate: CalendarText.day
                    )
                    // Opening the editor is asking for the value; the switch
                    // that used to gate it was bookkeeping.
                    .onAppear { model.hasAcquisitionDate = true }
                    .accessibilityIdentifier("plants.add.acquisitionDate")

                    // Which kind of date it is — sown, planted, acquired — is
                    // a small closed set and reads as chips beside the date it
                    // qualifies.
                    ChoiceChipGrid(
                        fieldName: model.acquisitionDateLabel,
                        options: PlantAcquisitionDateType.allCases.map {
                            ChoiceChipGrid.Option(
                                value: $0,
                                label: model.acquisitionDateTypeName($0),
                                symbol: PlantSymbols.acquisitionDateType($0)
                            )
                        },
                        selection: $model.acquisitionDateType
                    )
                    .accessibilityIdentifier("plants.add.acquisitionDateType")
                }
            }
        }
    }

    private var placementSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: PlantSymbols.placement, title: model.placementLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    mapObjectRow(model.gardenAreaLabel, field: .gardenArea)
                    mapObjectRow(model.placementLabel, field: .placement)
                    InlineMessage(model.mapObjectIdHint, tone: .neutral)
                }
            }
        }
    }

    private func mapObjectRow(_ label: String, field: MapObjectPlacementField) -> some View {
        Button {
            Task { await model.openMapObjectPicker(for: field) }
        } label: {
            HStack {
                Text(label)
                    .foregroundStyle(Palette.text)
                Spacer(minLength: 0)
                Text(model.mapObjectSummary(for: field) ?? model.mapObjectPickerClearTitle)
                    .foregroundStyle(Palette.textMuted)
                Image(systemName: "chevron.right")
                    .foregroundStyle(Palette.textMuted)
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(field == .gardenArea ? "plants.add.gardenAreaField" : "plants.add.placementField")
    }

    private var isSubmitDisabled: Bool {
        model.state == .submitting
            || model.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The model holds the count as text, because that is what the command
    /// payload carries and what an empty field means. The nudgeable numeral
    /// works in numbers, so the two meet here rather than in the model — an
    /// unparsable or absent value reads as one, which is the smallest group a
    /// group can be.
    private var quantityBinding: Binding<Double> {
        Binding(
            get: { Double(model.quantityText) ?? 1 },
            set: { model.quantityText = String(Int($0.rounded())) }
        )
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
            Chip(symbol: symbol, label: label, tone: .neutral)
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(
                            isSelected ? Palette.interaction : Color.clear,
                            lineWidth: Metrics.hairline
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
