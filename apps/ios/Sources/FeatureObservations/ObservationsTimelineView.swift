import CoreDesignSystem
import CoreDomain
import SwiftUI

/// A garden's observation journal: a chronological history, an optional
/// per-plant filter, and a correction action per entry.
///
/// What changed: recording an observation was a nine-control `Section` pinned
/// above the history, so the history — the thing a journal exists to show —
/// started below the fold and the screen read as a form with a list attached.
/// Recording now happens in a sheet behind a toolbar button
/// (``ObservationRecordSheetView``), and the timeline occupies the screen.
///
/// Each entry became a card led by a symbol medallion that says at a glance
/// what kind of entry it is — a plain note, a correction, or one carrying
/// photo analysis — with the timestamp, correction state, and pending-sync
/// state as chips rather than as three more lines of grey text. Correcting an
/// entry moved into a long-press context menu and a trailing swipe, so the
/// button that used to sit inside every single row is gone.
///
/// The contract this screen keeps: a row's `isCorrected` flag and any
/// photo-analysis result are surfaced plainly, never as a confirmed diagnosis,
/// and correcting an entry never edits it — the original stays visible
/// underneath the later correction.
public struct ObservationsTimelineView: View {
    @State private var model: ObservationsTimelineViewModel
    @State private var isRecordPresented = false

    public init(model: ObservationsTimelineViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .screenBackground()
            .task { await model.load() }
            .refreshable { await model.load() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isRecordPresented = true
                    } label: {
                        Label(model.recordSectionTitle, systemImage: "plus")
                    }
                    .accessibilityIdentifier("observations.record.open")
                }
            }
            .sheet(isPresented: $isRecordPresented) {
                ObservationRecordSheetView(model: model) { didSucceed in
                    Haptics.play(didSucceed ? .success : .failure)
                    if didSucceed { isRecordPresented = false }
                }
            }
            .sheet(isPresented: isCorrectionSheetPresented) {
                ObservationCorrectionSheetView(
                    title: model.correctionSheetTitle,
                    correctionKindLabel: model.correctionKindLabel,
                    noteTextLabel: model.noteTextLabel,
                    conditionSummaryLabel: model.conditionSummaryLabel,
                    submitTitle: model.correctionSubmitTitle,
                    closeTitle: model.closeTitle,
                    isSubmitting: model.isSubmittingCorrection,
                    errorMessage: model.correctionErrorMessage,
                    correctionKindName: { model.correctionKindName($0) },
                    onSubmit: { kind, note, condition in
                        await model.submitCorrection(
                            kind: kind, noteText: note, conditionSummary: condition)
                    },
                    onClose: { model.correctingObservationId = nil }
                )
            }
    }

    private var isCorrectionSheetPresented: Binding<Bool> {
        Binding(
            get: { model.correctingObservationId != nil },
            set: { isPresented in if !isPresented { model.correctingObservationId = nil } }
        )
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("observations.loading")

        case let .loaded(rows) where rows.isEmpty:
            VStack(spacing: Metrics.space4) {
                filterBar
                EmptyStateView(
                    symbol: "book.closed",
                    title: model.title,
                    message: model.emptyMessage,
                    actionTitle: model.recordSectionTitle,
                    action: { isRecordPresented = true }
                )
                .accessibilityIdentifier("observations.empty")
                Spacer()
            }
            .padding(Metrics.space4)

        case let .loaded(rows):
            // Above the `List`, not a `Section` of it — see
            // `FeatureTasks.TasksListView` for the screenshot that prompted it.
            VStack(spacing: 0) {
                filterBar

                List {
                    ForEach(rows) { row in
                        rowView(row)
                            .listRowInsets(
                                EdgeInsets(
                                    top: Metrics.space1,
                                    leading: Metrics.space4,
                                    bottom: Metrics.space1,
                                    trailing: Metrics.space4
                                )
                            )
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button {
                                    model.correctingObservationId = row.id
                                } label: {
                                    Label(
                                        model.correctActionTitle,
                                        systemImage: ObservationSymbols.correct
                                    )
                                }
                                .tint(Palette.interaction)
                                .accessibilityIdentifier("observations.row.\(row.id).correct")
                            }
                            .contextMenu {
                                Button {
                                    model.correctingObservationId = row.id
                                } label: {
                                    Label(
                                        model.correctActionTitle,
                                        systemImage: ObservationSymbols.correct
                                    )
                                }
                            }
                    }
                }
                .listStyle(.plain)
            }

        case let .failed(message):
            FailureStateView(
                message: message,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("observations.failure")
        }
    }

    /// The plant filter, as a single field with an inline clear affordance
    /// rather than a labelled row plus two separate buttons.
    private var filterBar: some View {
        HStack(spacing: Metrics.space2) {
            SearchStrip(
                accessibilityName: model.plantIdLabel,
                placeholder: model.plantIdLabel,
                clearLabel: model.closeTitle,
                query: $model.plantIdFilter,
                search: { _ in await model.load() }
            )
            .accessibilityIdentifier("observations.filter.plantIdField")

            if model.plantIdFilter.isEmpty {
                Button {
                    Task { await model.load() }
                } label: {
                    Label(model.filterApplyTitle, systemImage: "magnifyingglass")
                        .labelStyle(.iconOnly)
                }
                .accessibilityLabel(model.filterApplyTitle)
                .accessibilityIdentifier("observations.filter.apply")
            } else {
                Button {
                    Task { await model.clearFilter() }
                } label: {
                    Label(model.filterClearTitle, systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                }
                .accessibilityLabel(model.filterClearTitle)
                .accessibilityIdentifier("observations.filter.clear")
            }
        }
        .tint(Palette.interaction)
        .padding(.horizontal, Metrics.space4)
        .padding(.vertical, Metrics.space2)
    }

    private func rowView(_ row: ObservationRow) -> some View {
        SurfaceCard {
            HStack(alignment: .top, spacing: Metrics.space3) {
                IconMedallion(
                    symbol: ObservationSymbols.entry(row),
                    label: row.correctionKindLabel ?? model.title,
                    tone: .neutral
                )

                VStack(alignment: .leading, spacing: Metrics.space2) {
                    HStack(spacing: Metrics.space2) {
                        Chip(
                            symbol: ObservationSymbols.observedAt,
                            label: row.observedAtText,
                            tone: .neutral
                        )
                        if row.isCorrected {
                            Chip(
                                symbol: ObservationSymbols.corrected,
                                label: model.correctedBadgeText,
                                tone: .neutral
                            )
                        }
                        if row.isPendingSync {
                            StatusGlyph(
                                symbol: ObservationSymbols.pendingSync,
                                label: model.savedLocallyBadgeText,
                                tone: .warning
                            )
                            .accessibilityIdentifier("observations.row.\(row.id).pendingSync")
                        }
                        Spacer(minLength: 0)
                    }
                    .lineLimit(1)

                    if let correctionOfText = model.correctionOfText(for: row) {
                        Text(correctionOfText)
                            .font(FieldConsoleType.detail.font)
                            .foregroundStyle(Palette.textMuted)
                            .accessibilityIdentifier("observations.row.\(row.id).correctionOf")
                    }

                    if let noteText = row.noteText, !noteText.isEmpty {
                        Text(noteText)
                            .font(FieldConsoleType.body.font)
                            .foregroundStyle(Palette.text)
                    }

                    if let conditionSummary = row.conditionSummary, !conditionSummary.isEmpty {
                        Text(conditionSummary)
                            .font(FieldConsoleType.detail.font)
                            .foregroundStyle(Palette.textMuted)
                    }

                    if !row.symptomLabels.isEmpty {
                        // Above the analyses and labelled as the observer's
                        // own: a model's suggestion and a person's testimony
                        // must not read as one list.
                        VStack(alignment: .leading, spacing: Metrics.space1) {
                            Text(model.symptomsReportedLabel)
                                .font(FieldConsoleType.detail.font)
                                .foregroundStyle(Palette.textMuted)
                            ForEach(row.symptomLabels, id: \.self) { label in
                                Text(label)
                                    .font(FieldConsoleType.detail.font)
                                    .foregroundStyle(Palette.text)
                            }
                        }
                        .accessibilityIdentifier("observations.row.\(row.id).symptoms")
                    }

                    ForEach(row.analysisSummaries) { summary in
                        analysisView(summary)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("observations.row.\(row.id)")
    }

    /// A health suggestion (P11-HEALTH-01), always alongside its disclaimer.
    ///
    /// The disclaimer is a warning-toned `InlineMessage` with its own symbol,
    /// so "this is a suggestion, not a diagnosis" reads at the same glance as
    /// the suggestion itself rather than as a footnote below it.
    /// `modelUnavailable` replaces the suggestion line with an honest
    /// "no model reached" notice instead — see `ObservationAnalysisSummary`'s
    /// own doc comment.
    private func analysisView(_ summary: ObservationAnalysisSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            HStack(spacing: Metrics.space2) {
                Chip(
                    symbol: ObservationSymbols.analysis,
                    label: summary.kindLabel,
                    tone: .neutral
                )
                Chip(
                    symbol: ObservationSymbols.safetyClass,
                    label: summary.safetyClassLabel,
                    tone: summary.safetyClassTone
                )
            }

            if summary.modelUnavailable {
                InlineMessage(model.analysisModelUnavailableMessage, tone: .neutral)
            } else {
                HStack(spacing: Metrics.space2) {
                    Text(summary.suggestedLabel)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.text)
                    Text(summary.confidenceText)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                }

                if summary.requiresConfirmation {
                    InlineMessage(model.analysisDisclaimer, tone: .warning)
                }
                if summary.requestedAdditionalEvidence {
                    InlineMessage(model.additionalEvidenceRequested, tone: .warning)
                }
                if !summary.evidenceSummary.isEmpty {
                    Text(model.analysisEvidenceSummaryText(summary.evidenceSummary))
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                }
                if !summary.alternativeExplanations.isEmpty {
                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(model.analysisAlternativeExplanationsLabel)
                            .font(FieldConsoleType.detail.font)
                            .foregroundStyle(Palette.textMuted)
                        ForEach(summary.alternativeExplanations, id: \.self) { explanation in
                            Text("• \(explanation)")
                                .font(FieldConsoleType.detail.font)
                                .foregroundStyle(Palette.textMuted)
                        }
                    }
                }
            }

            dispositionControl(summary)
        }
        .padding(Metrics.space2)
        .background(
            RoundedRectangle(cornerRadius: Metrics.radiusSmall, style: .continuous)
                .fill(Palette.surfaceSunken)
        )
        .accessibilityIdentifier("observations.analysis.\(summary.id)")
    }

    /// A reviewer's disposition on this health suggestion — reconsiderable
    /// freely, so this is always an active `Picker` plus a "Save" action,
    /// never a one-shot confirmation.
    private func dispositionControl(_ summary: ObservationAnalysisSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                // Chips rather than a menu: a menu hides every option but the
                // chosen one behind a tap, and deciding what to do with a
                // model's proposal is exactly when the alternatives should be
                // visible together.
                ChoiceChipGrid(
                    fieldName: model.analysisDispositionLabel,
                    options: HealthSuggestionDisposition.allCases.map {
                        ChoiceChipGrid.Option(
                            value: $0,
                            label: model.dispositionName($0),
                            symbol: "stethoscope"
                        )
                    },
                    selection: Binding(
                        get: { model.disposition(for: summary) },
                        set: { model.selectedDisposition[summary.id] = $0 }
                    )
                )
                .accessibilityIdentifier("observations.analysis.\(summary.id).disposition")

                Button(model.analysisSaveDispositionTitle) {
                    Task { await model.saveDisposition(for: summary) }
                }
                .disabled(
                    model.isSavingDisposition.contains(summary.id)
                        || model.disposition(for: summary) == summary.disposition
                )
                .accessibilityIdentifier("observations.analysis.\(summary.id).saveDisposition")
            }

            if let dispositionSetAtText = summary.dispositionSetAtText {
                Text(dispositionSetAtText)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            }
            if model.dispositionSavedIds.contains(summary.id) {
                InlineMessage(model.analysisDispositionSavedMessage, tone: .positive)
            }
            if let errorMessage = model.dispositionErrorMessage[summary.id] {
                InlineMessage(errorMessage, tone: .negative)
            }
        }
    }
}
