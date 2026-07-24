import CoreDomain
import CoreMediaTransfer
import PhotosUI
import SwiftUI

/// A garden's observation timeline: chronological history, an optional
/// per-plant filter, a "record observation" form (including, as of
/// P6-IOS-01, a photo attachment), and a correction ("amend"/"supersede")
/// action per row.
///
/// A row's `isCorrected` flag and any photo-analysis results are surfaced
/// plainly — never as a confirmed diagnosis — and correcting a row never
/// edits it: the original stays visible underneath the new correction row.
///
/// Photo attachment is real, working upload capability as of P6-IOS-01 —
/// see `ObservationsTimelineViewModel.photoAttachment`'s own doc comment.
/// Recording a note and/or a condition summary still works fully without a
/// photo; the submit action is disabled only while a picked photo is still
/// mid-upload (`ObservationsTimelineViewModel.isPhotoBlockingSubmit`).
public struct ObservationsTimelineView: View {
    @State private var model: ObservationsTimelineViewModel
    @State private var pickedPhotoItem: PhotosPickerItem?

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
        .onChange(of: pickedPhotoItem) { _, newItem in
            guard let newItem else { return }
            Task { await loadAndAttach(newItem) }
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

            photoPickerRow

            if let message = model.recordErrorMessage {
                Text(message).foregroundStyle(.red)
                    .accessibilityIdentifier("observations.record.failure")
            }

            Button(model.recordSubmitTitle) {
                Task { await model.submitRecordObservation() }
            }
            .disabled(model.isSubmittingRecord || model.isPhotoBlockingSubmit)
            .accessibilityIdentifier("observations.record.submit")
        }
    }

    /// Absent entirely for a view model built with no `photoAttachment` —
    /// see `FeaturePlants.PlantDetailView.photoSection`'s identical
    /// reasoning.
    @ViewBuilder
    private var photoPickerRow: some View {
        if let photoAttachment = model.photoAttachment {
            PhotosPicker(model.photoPickButtonTitle, selection: $pickedPhotoItem, matching: .images)
                .accessibilityIdentifier("observations.record.photo.pick")

            if photoAttachment.status != .idle {
                Text(model.photoStatusText)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("observations.record.photo.status")

                if photoAttachment.status.isRetryable, case .failed = photoAttachment.status {
                    Button(model.photoRetryButtonTitle) {
                        Task { await model.retryRecordPhotoUpload() }
                    }
                    .accessibilityIdentifier("observations.record.photo.retry")
                }

                Button(model.photoRemoveButtonTitle, role: .destructive) {
                    pickedPhotoItem = nil
                    Task { await model.discardRecordPhoto() }
                }
                .accessibilityIdentifier("observations.record.photo.remove")
            }
        }
    }

    /// See `FeaturePlants.PlantDetailView.loadAndAttach`'s identical doc
    /// comment.
    private func loadAndAttach(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        await model.pickRecordPhoto(data: data, contentType: contentType)
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
