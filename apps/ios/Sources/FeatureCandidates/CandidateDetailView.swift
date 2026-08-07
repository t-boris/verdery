import CoreDesignSystem
import CoreDomain
import SwiftUI

/// A single candidate: its facts, edit form, status control, suitability
/// assessment, and conversion into a real plant — mirrors
/// `apps/web/features/candidates/candidate-detail.tsx`'s composition.
///
/// Once `status == .converted`, the edit/status/convert sections are
/// replaced with a plain notice — a converted candidate is a frozen
/// historical record. The suitability panel stays visible either way: it is
/// a useful historical read regardless of the candidate's current status.
public struct CandidateDetailView: View {
    @State private var model: CandidateDetailViewModel
    @State private var isConvertConfirmationPresented = false
    @State private var isDeleteConfirmationPresented = false
    @Environment(\.dismiss) private var dismiss

    public init(model: CandidateDetailViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(displayNameOrFallback)
            .inlineNavigationTitle()
            .screenBackground()
            .task { await model.load() }
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
            // Converting is this screen's own terminal action — dismiss back
            // to the candidate list on success, the same "pop after a
            // successful irreversible action" shape
            // `PlantDetailView.delete()` already uses. The reader finds the
            // newly created plant in the Plants tab's own list, which
            // refreshes independently; deep-linking straight to it would
            // need to cross from this feature's stack into `FeaturePlants`'
            // and is a real, separate follow-up, not built this pass.
            .onChange(of: model.convertedPlantId) { _, newValue in
                if newValue != nil {
                    Haptics.play(.success)
                    dismiss()
                }
            }
            // Attached at the top level, not nested inside a leaf section —
            // `PlantDetailView`'s own identical `confirmationDialog` doc
            // comment found that nesting it deeper left the dialog opening
            // but its confirmation never reaching the network.
            .confirmationDialog(
                model.convertSubmitTitle,
                isPresented: $isConvertConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button(model.convertSubmitTitle) {
                    Task { await model.convert() }
                }
                Button(model.closeTitle, role: .cancel) {}
            } message: {
                Text(model.convertDescription)
            }
            // Deleting is terminal in the same way converting is: there is no
            // row left for this screen to render, so it pops rather than
            // showing an empty detail.
            .onChange(of: model.didDelete) { _, deleted in
                if deleted {
                    Haptics.play(.success)
                    dismiss()
                }
            }
            .confirmationDialog(
                model.deleteSubmitTitle,
                isPresented: $isDeleteConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button(model.deleteConfirmTitle, role: .destructive) {
                    Task { await model.delete() }
                }
                Button(model.closeTitle, role: .cancel) {}
            } message: {
                Text(model.deleteDescription)
            }
    }

    private var displayNameOrFallback: String {
        guard case let .loaded(candidate) = model.state else { return "" }
        return candidate.displayName
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("candidates.detail.loading")

        case .failed:
            FailureStateView(message: model.notFoundMessage)
                .accessibilityIdentifier("candidates.detail.failure")

        case let .loaded(candidate):
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    summaryCard(candidate)
                    suitabilitySection

                    if model.isConverted {
                        InlineMessage(model.alreadyConvertedMessage, tone: .neutral)
                            .accessibilityIdentifier("candidates.detail.alreadyConverted")
                    } else {
                        editSection(candidate)
                        statusSection(candidate)
                        convertSection
                        deleteSection
                    }
                }
                .padding(Metrics.space4)
            }
        }
    }

    private func summaryCard(_ candidate: PlantCandidate) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text(candidate.displayName)
                    .font(Typography.title)
                    .foregroundStyle(Palette.text)
                HStack(spacing: Metrics.space2) {
                    Chip(
                        symbol: CandidateSymbols.status,
                        label: model.statusName(candidate.status),
                        tone: CandidatesLocalization.tone(for: candidate.status)
                    )
                    if let priority = candidate.priority {
                        Text(model.priorityName(priority))
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                    if let quantity = candidate.quantity {
                        Text("\(quantity)")
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                }
            }
        }
        .accessibilityIdentifier("candidates.detail.summary")
    }

    private var suitabilitySection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CandidateSymbols.suitability, title: model.suitabilityTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text(model.suitabilityDescription)
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)

                    if model.isLoadingSuitability {
                        LoadingStateView(model.suitabilityLoadingMessage)
                    } else if let suitability = model.suitability {
                        ForEach(Array(suitability.findings.enumerated()), id: \.offset) { _, finding in
                            findingRow(finding)
                        }
                    } else {
                        Text(model.suitabilityNoneMessage)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }

                    Button {
                        Task { await model.recalculateSuitability() }
                    } label: {
                        Text(model.isRecalculatingSuitability ? model.suitabilityRecalculatingTitle : model.suitabilityRecalculateTitle)
                    }
                    .disabled(model.isRecalculatingSuitability)
                    .accessibilityIdentifier("candidates.detail.suitability.recalculate")

                    if let message = model.suitabilityErrorMessage {
                        InlineMessage(message)
                    }
                }
            }
        }
        .accessibilityIdentifier("candidates.detail.suitability")
    }

    private func findingRow(_ finding: SuitabilityFinding) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            HStack(spacing: Metrics.space2) {
                Text(model.axisName(finding.axis))
                    .font(Typography.detail.weight(.medium))
                    .foregroundStyle(Palette.text)
                Chip(symbol: CandidateSymbols.suitability, label: model.categoryName(finding.category), tone: model.categoryTone(finding.category))
            }

            if finding.category == .unknown, let reason = finding.reason {
                Text(model.unknownReasonName(reason))
                    .font(Typography.micro)
                    .foregroundStyle(Palette.textMuted)
            }

            if finding.category != .unknown, let explanation = finding.explanation {
                Text(explanation)
                    .font(Typography.detail)
                    .foregroundStyle(Palette.text)
            }

            if finding.category == .assumption, let assumedValue = finding.assumedValue {
                Text(model.assumedValueText(assumedValue))
                    .font(Typography.micro)
                    .foregroundStyle(Palette.textMuted)
            }

            ForEach(Array(finding.evidence.enumerated()), id: \.offset) { _, evidence in
                Text("\(model.suitabilityEvidenceLabel): \(evidence.factKey) — \(model.evidenceValueText(evidence.value))")
                    .font(Typography.micro)
                    .foregroundStyle(Palette.textMuted)
            }
        }
        .padding(.vertical, Metrics.space1)
    }

    private func editSection(_ candidate: PlantCandidate) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CandidateSymbols.candidate, title: model.editTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.displayNameLabel, text: $model.displayName)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.detail.displayNameField")

                    TextField(model.varietyLabelLabel, text: $model.varietyLabel)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.detail.varietyLabelField")

                    Button {
                        model.isTaxonomyPickerPresented = true
                    } label: {
                        HStack {
                            Text(model.taxonomyLabel)
                                .foregroundStyle(Palette.text)
                            Spacer(minLength: 0)
                            Text(model.selectedTaxonomySummary)
                                .foregroundStyle(Palette.textMuted)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("candidates.detail.taxonomyRow")

                    if candidate.groupingKind != .individual {
                        TextField(model.quantityLabel, text: $model.quantityText)
                            .textFieldStyle(.roundedBorder)
                            #if os(iOS)
                                .keyboardType(.numberPad)
                            #endif
                            .accessibilityIdentifier("candidates.detail.quantityField")
                    }

                    TextField(model.rationaleNoteLabel, text: $model.rationaleNote)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.detail.rationaleNoteField")

                    HStack(spacing: Metrics.space2) {
                        TextField(model.priceAmountLabel, text: $model.priceAmountText)
                            .textFieldStyle(.roundedBorder)
                            #if os(iOS)
                                .keyboardType(.decimalPad)
                            #endif
                        TextField(model.priceCurrencyLabel, text: $model.priceCurrency)
                            .textFieldStyle(.roundedBorder)
                    }

                    TextField(model.purchaseSourceLabel, text: $model.purchaseSource)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.detail.purchaseSourceField")

                    Button(model.saveDetailsTitle) {
                        Task { await model.saveDetails() }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isSavingDetails)
                    .accessibilityIdentifier("candidates.detail.saveDetails")

                    if model.detailsSaved {
                        InlineMessage(model.detailsSavedMessage, tone: .positive)
                    }
                    if let message = model.detailsErrorMessage {
                        InlineMessage(message)
                    }
                }
            }
        }
        .accessibilityIdentifier("candidates.detail.edit")
    }

    private func statusSection(_ candidate: PlantCandidate) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CandidateSymbols.status, title: model.statusTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    HStack(spacing: Metrics.space2) {
                        ForEach(CandidateDetailViewModel.settableStatuses, id: \.self) { status in
                            CandidateChoiceChip(
                                label: model.statusName(status),
                                isSelected: model.selectedStatus == status
                            ) {
                                model.selectedStatus = status
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityIdentifier("candidates.detail.statusPicker")

                    Button(model.saveStatusTitle) {
                        Task { await model.saveStatus() }
                    }
                    .disabled(model.isSavingStatus || model.selectedStatus == candidate.status)
                    .accessibilityIdentifier("candidates.detail.saveStatus")

                    if model.statusSaved {
                        InlineMessage(model.statusSavedMessage, tone: .positive)
                    }
                    if let message = model.statusErrorMessage {
                        InlineMessage(message)
                    }
                }
            }
        }
        .accessibilityIdentifier("candidates.detail.status")
    }

    private var convertSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CandidateSymbols.convert, title: model.convertTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text(model.convertDescription)
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)

                    Toggle(model.convertAcquisitionDateToggleLabel, isOn: $model.hasConvertAcquisitionDate)
                        .accessibilityIdentifier("candidates.detail.convertAcquisitionDateToggle")

                    if model.hasConvertAcquisitionDate {
                        DatePicker(
                            model.convertAcquisitionDateLabel,
                            selection: $model.convertAcquisitionDate,
                            displayedComponents: .date
                        )
                        .accessibilityIdentifier("candidates.detail.convertAcquisitionDatePicker")

                        HStack(spacing: Metrics.space2) {
                            ForEach(PlantAcquisitionDateType.allCases, id: \.self) { type in
                                CandidateChoiceChip(
                                    label: model.acquisitionDateTypeName(type),
                                    isSelected: model.convertAcquisitionDateType == type
                                ) {
                                    model.convertAcquisitionDateType = type
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .accessibilityIdentifier("candidates.detail.convertAcquisitionDateTypePicker")
                    }

                    Button {
                        isConvertConfirmationPresented = true
                    } label: {
                        Text(model.convertSubmitTitle)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isConverting)
                    .accessibilityIdentifier("candidates.detail.convertSubmit")

                    if let message = model.convertErrorMessage {
                        InlineMessage(message)
                    }
                }
            }
        }
        .accessibilityIdentifier("candidates.detail.convert")
    }

    /// Permanent removal, kept visually separate from the disposal statuses
    /// above because it is the only action on this screen that destroys
    /// anything. Not rendered at all for a converted candidate — the caller
    /// already gates this whole region on that.
    private var deleteSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CandidateSymbols.delete, title: model.deleteTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text(model.deleteDescription)
                        .font(Typography.detail)
                        .foregroundStyle(.secondary)

                    Button(role: .destructive) {
                        isDeleteConfirmationPresented = true
                    } label: {
                        Text(model.deleteSubmitTitle)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.isDeleting)
                    .accessibilityIdentifier("candidates.detail.deleteSubmit")

                    if let message = model.deleteErrorMessage {
                        InlineMessage(message)
                    }
                }
            }
        }
        .accessibilityIdentifier("candidates.detail.delete")
    }
}
