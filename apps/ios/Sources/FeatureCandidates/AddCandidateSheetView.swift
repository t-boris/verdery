import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The add-a-candidate sheet — mirrors `FeaturePlants.PlantAddSheetView`'s
/// shape (chip-row enum pickers, collapsed optional groups), scoped down
/// per `AddCandidateViewModel`'s own doc comment (no placement/
/// alternative-candidate fields this pass).
struct AddCandidateSheetView: View {
    @Bindable var model: AddCandidateViewModel
    let onCancel: () -> Void
    let onFinish: (Bool) -> Void

    @FocusState private var isDisplayNameFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    identitySection
                    groupingSection
                    planningSection

                    if let message = model.errorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("candidates.add.failure")
                    }

                    Button(action: submit) {
                        Label(model.submitTitle, systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSubmitDisabled)
                    .accessibilityIdentifier("candidates.add.submit")
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
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
                CandidateTaxonomyReferencePickerView(
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
            SectionEyebrow(symbol: CandidateSymbols.candidate, title: model.displayNameLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.displayNameLabel, text: $model.displayName)
                        .textFieldStyle(.roundedBorder)
                        .focused($isDisplayNameFocused)
                        .accessibilityIdentifier("candidates.add.displayNameField")

                    TextField(model.varietyLabelLabel, text: $model.varietyLabel)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.add.varietyLabelField")

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
                    Text(model.taxonomyLabel)
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Text(model.selectedTaxonomySummary)
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                    Image(systemName: CandidateSymbols.chevron)
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("candidates.add.taxonomyRow")

            if model.selectedTaxonomyReference != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .font(Typography.detail)
                    .tint(Palette.negative)
                    .accessibilityIdentifier("candidates.add.taxonomyClear")
            }
        }
    }

    private var groupingSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "square.grid.2x2", title: model.groupingKindLabel)

            HStack(spacing: Metrics.space2) {
                ForEach(PlantGroupingKind.allCases, id: \.self) { kind in
                    CandidateChoiceChip(
                        label: model.groupingKindName(kind),
                        isSelected: model.groupingKind == kind
                    ) {
                        model.groupingKind = kind
                    }
                }
                Spacer(minLength: 0)
            }
            .accessibilityIdentifier("candidates.add.groupingKindPicker")

            if model.groupingKind != .individual {
                SurfaceCard {
                    TextField(model.quantityLabel, text: $model.quantityText)
                        .textFieldStyle(.roundedBorder)
                        #if os(iOS)
                            .keyboardType(.numberPad)
                        #endif
                        .accessibilityIdentifier("candidates.add.quantityField")
                }
            }
        }
    }

    private var planningSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CandidateSymbols.priority, title: model.priorityLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.rationaleNoteLabel, text: $model.rationaleNote)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.add.rationaleNoteField")

                    HStack(spacing: Metrics.space2) {
                        CandidateChoiceChip(label: model.priorityNoneLabel, isSelected: model.priority == nil) {
                            model.priority = nil
                        }
                        ForEach(PlantCandidatePriority.allCases, id: \.self) { priority in
                            CandidateChoiceChip(
                                label: model.priorityName(priority),
                                isSelected: model.priority == priority
                            ) {
                                model.priority = priority
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityIdentifier("candidates.add.priorityPicker")

                    HStack(spacing: Metrics.space2) {
                        TextField(model.priceAmountLabel, text: $model.priceAmountText)
                            .textFieldStyle(.roundedBorder)
                            #if os(iOS)
                                .keyboardType(.decimalPad)
                            #endif
                            .accessibilityIdentifier("candidates.add.priceAmountField")

                        TextField(model.priceCurrencyLabel, text: $model.priceCurrency)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("candidates.add.priceCurrencyField")
                    }

                    TextField(model.purchaseSourceLabel, text: $model.purchaseSource)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.add.purchaseSourceField")
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
            await model.submit()
            onFinish(model.errorMessage == nil)
        }
    }
}

/// A chip that is also a single-choice control — duplicates
/// `FeaturePlants.PlantChoiceChip` verbatim (minus its `symbol` parameter,
/// which this form's grouping-kind/priority chips have no per-value icon
/// for) rather than importing it; see `CandidatesLocalization`'s own doc
/// comment for why.
struct CandidateChoiceChip: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button {
            action()
            Haptics.play(.selection)
        } label: {
            Text(label)
                .font(Typography.detail)
                .padding(.horizontal, Metrics.space3)
                .padding(.vertical, Metrics.space2)
                .background(
                    Capsule(style: .continuous)
                        .fill(Tone.neutral.quietFill)
                )
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(isSelected ? Palette.interaction : Color.clear, lineWidth: Metrics.hairline)
                )
                .foregroundStyle(Palette.text)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
