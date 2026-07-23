import CoreDomain
import SwiftUI

/// A garden's observation timeline: chronological history, an optional
/// per-plant filter, a "record observation" form, and a correction
/// ("amend"/"supersede") action per row.
///
/// A row's `isCorrected` flag and any photo-analysis results are surfaced
/// plainly — never as a confirmed diagnosis — and correcting a row never
/// edits it: the original stays visible underneath the new correction row.
///
/// Photo attachment is out of scope this pass: `RecordObservation`/
/// `CorrectObservation` never populate `photoMediaIds` (see
/// `ObservationsUseCases.swift`'s doc comment) because this codebase has no
/// file-upload flow yet to produce a `mediaId` from. Recording a note and/or
/// a condition summary works fully without a photo.
public struct ObservationsTimelineView: View {
    @State private var model: ObservationsTimelineViewModel

    public init(model: ObservationsTimelineViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        List {
            filterSection
            recordSection
            timelineSection
        }
        .navigationTitle(model.title)
        .task { await model.load() }
        .refreshable { await model.load() }
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
                    await model.submitCorrection(kind: kind, noteText: note, conditionSummary: condition)
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

    private var filterSection: some View {
        Section(model.filterLabel) {
            TextField(model.plantIdLabel, text: $model.plantIdFilter)
                .accessibilityIdentifier("observations.filter.plantIdField")
            HStack {
                Button(model.filterApplyTitle) { Task { await model.load() } }
                    .accessibilityIdentifier("observations.filter.apply")
                if !model.plantIdFilter.isEmpty {
                    Button(model.filterClearTitle) { Task { await model.clearFilter() } }
                        .accessibilityIdentifier("observations.filter.clear")
                }
            }
        }
    }

    private var recordSection: some View {
        Section(model.recordSectionTitle) {
            TextField(model.noteTextLabel, text: $model.recordNoteText, axis: .vertical)
                .accessibilityIdentifier("observations.record.noteField")
            TextField(model.conditionSummaryLabel, text: $model.recordConditionSummary, axis: .vertical)
                .accessibilityIdentifier("observations.record.conditionField")
            TextField(model.plantIdLabel, text: $model.recordPlantId)
                .accessibilityIdentifier("observations.record.plantIdField")
            TextField(model.gardenObjectIdLabel, text: $model.recordGardenObjectId)
                .accessibilityIdentifier("observations.record.gardenObjectIdField")
            Text(model.mapObjectIdHint)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Toggle(model.observedAtToggleLabel, isOn: $model.recordHasObservedAt)
                .accessibilityIdentifier("observations.record.observedAtToggle")
            if model.recordHasObservedAt {
                DatePicker(model.observedAtLabel, selection: $model.recordObservedAt)
                    .accessibilityIdentifier("observations.record.observedAtPicker")
            }

            if let message = model.recordErrorMessage {
                Text(message).foregroundStyle(.red)
                    .accessibilityIdentifier("observations.record.failure")
            }

            Button(model.recordSubmitTitle) {
                Task { await model.submitRecordObservation() }
            }
            .disabled(model.isSubmittingRecord)
            .accessibilityIdentifier("observations.record.submit")
        }
    }

    @ViewBuilder
    private var timelineSection: some View {
        switch model.state {
        case .loading:
            Section {
                ProgressView(model.loadingMessage)
                    .accessibilityIdentifier("observations.loading")
            }

        case let .loaded(rows) where rows.isEmpty:
            Section {
                Text(model.emptyMessage)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("observations.empty")
            }

        case let .loaded(rows):
            Section {
                ForEach(rows) { row in
                    rowView(row)
                }
            }

        case let .failed(message):
            Section {
                Text(message)
                    .accessibilityIdentifier("observations.failure")
                Button(model.retryTitle) { Task { await model.load() } }
            }
        }
    }

    private func rowView(_ row: ObservationRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(row.observedAtText).font(.footnote).foregroundStyle(.secondary)
                if row.isCorrected {
                    Text(model.correctedBadgeText)
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .background(Capsule().fill(Color.secondary.opacity(0.2)))
                }
                if row.isPendingSync {
                    Text(model.savedLocallyBadgeText)
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .background(Capsule().fill(Color.secondary.opacity(0.2)))
                        .accessibilityIdentifier("observations.row.\(row.id).pendingSync")
                }
            }

            if let correctionOfText = model.correctionOfText(for: row) {
                Text(correctionOfText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("observations.row.\(row.id).correctionOf")
            }

            if let noteText = row.noteText, !noteText.isEmpty {
                Text(noteText)
            }
            if let conditionSummary = row.conditionSummary, !conditionSummary.isEmpty {
                Text(conditionSummary).foregroundStyle(.secondary)
            }

            ForEach(row.analysisSummaries) { summary in
                analysisView(summary)
            }

            Button(model.correctActionTitle) {
                model.correctingObservationId = row.id
            }
            .font(.footnote)
            .accessibilityIdentifier("observations.row.\(row.id).correct")
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("observations.row.\(row.id)")
    }

    private func analysisView(_ summary: ObservationAnalysisSummary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(summary.kindLabel): \(summary.suggestedLabel) (\(summary.confidenceText))")
                .font(.footnote)
            // Never shown as a confirmed diagnosis: the disclaimer is always
            // visible alongside the suggestion, not only when
            // `requiresConfirmation` happens to be true.
            if summary.requiresConfirmation {
                Text(model.analysisDisclaimer)
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            if summary.requestedAdditionalEvidence {
                Text(model.additionalEvidenceRequested)
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
        .accessibilityIdentifier("observations.analysis.\(summary.id)")
    }
}
