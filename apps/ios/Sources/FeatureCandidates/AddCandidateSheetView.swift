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

            VStack(alignment: .leading, spacing: Metrics.space3) {
                    ComposerField(
                        symbol: "leaf",
                        accessibilityName: model.displayNameLabel,
                        placeholder: model.displayNameLabel,
                        commitLabel: model.submitTitle,
                        text: $model.displayName,
                        commit: submit
                    )
                    .accessibilityIdentifier("candidates.add.displayNameField")

                    ComposerField(
                        symbol: "tag",
                        accessibilityName: model.varietyLabelLabel,
                        placeholder: model.varietyLabelLabel,
                        commitLabel: model.submitTitle,
                        text: $model.varietyLabel,
                        commit: submit
                    )
                    .accessibilityIdentifier("candidates.add.varietyLabelField")

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
                    Text(model.taxonomyLabel)
                        .font(FieldConsoleType.body.font)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Text(model.selectedTaxonomySummary)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                    Image(systemName: CandidateSymbols.chevron)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("candidates.add.taxonomyRow")

            if model.selectedTaxonomyReference != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .font(FieldConsoleType.detail.font)
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
                .accessibilityIdentifier("candidates.add.quantityField")
            }
        }
    }

    private var planningSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CandidateSymbols.priority, title: model.priorityLabel)

            VStack(alignment: .leading, spacing: Metrics.space3) {
                    // Why this plant is being considered is a note, and notes
                    // are content rather than controls.
                    NoteCanvas(
                        accessibilityName: model.rationaleNoteLabel,
                        placeholder: model.rationaleNoteLabel,
                        text: $model.rationaleNote
                    )
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

                    // A price is a numeral with a unit beside it, which is
                    // exactly the shape this component has — and it is the one
                    // that gets the reader's decimal separator right.
                    MeasureField(
                        fieldName: model.priceAmountLabel,
                        unitLabel: model.priceCurrency,
                        decreaseLabel: model.priceDecreaseLabel,
                        increaseLabel: model.priceIncreaseLabel,
                        value: priceBinding,
                        step: 1,
                        range: 0...1_000_000,
                        fractionDigits: 2,
                        locale: .autoupdatingCurrent
                    )
                    .accessibilityIdentifier("candidates.add.priceAmountField")

                    ComposerField(
                        symbol: "coloncurrencysign",
                        accessibilityName: model.priceCurrencyLabel,
                        placeholder: model.priceCurrencyLabel,
                        commitLabel: model.submitTitle,
                        text: $model.priceCurrency,
                        commit: submit
                    )
                    .accessibilityIdentifier("candidates.add.priceCurrencyField")

                    ComposerField(
                        symbol: "cart",
                        accessibilityName: model.purchaseSourceLabel,
                        placeholder: model.purchaseSourceLabel,
                        commitLabel: model.submitTitle,
                        text: $model.purchaseSource,
                        commit: submit
                    )
                    .accessibilityIdentifier("candidates.add.purchaseSourceField")
                }
        }
    }

    private var isSubmitDisabled: Bool {
        model.state == .submitting
            || model.displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The model holds these as text, because that is what an empty field
    /// means and what the command payload carries. The nudgeable numerals work
    /// in numbers, so the two meet here rather than in the model.
    private var quantityBinding: Binding<Double> {
        Binding(
            get: { Double(model.quantityText) ?? 1 },
            set: { model.quantityText = String(Int($0.rounded())) }
        )
    }

    /// Zero is a real price — a gift, a cutting from a neighbour — so an
    /// unparsable or empty value reads as zero rather than as one.
    private var priceBinding: Binding<Double> {
        Binding(
            get: { Double(model.priceAmountText) ?? 0 },
            // Written back POSIX, not localized: this string is the payload
            // the command carries, and the model parses it with `Double(_:)`.
            // A localized "12,5" would round-trip to nothing.
            set: { model.priceAmountText = String(($0 * 100).rounded() / 100) }
        )
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
                .font(FieldConsoleType.detail.font)
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
