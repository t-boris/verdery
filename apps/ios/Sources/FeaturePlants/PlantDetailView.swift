import CoreDomain
import CoreMediaTransfer
import PhotosUI
import SwiftUI

/// A single plant's detail screen: view, edit, lifecycle stage, status
/// (including delete), move, and — as of P6-IOS-01 — attaching a photo.
public struct PlantDetailView: View {
    @State private var model: PlantDetailViewModel
    @State private var pickedPhotoItem: PhotosPickerItem?

    public init(model: PlantDetailViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .task { await model.load() }
            .onChange(of: pickedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task { await loadAndAttach(newItem) }
            }
            .onChange(of: model.photoAttachment?.mediaId) { _, mediaId in
                guard let mediaId else { return }
                Task { await model.attachPickedPhoto(mediaId: mediaId) }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView(model.loadingMessage)
                .accessibilityIdentifier("plants.detail.loading")

        case let .loaded(summary):
            Form {
                summarySection(summary)
                photoSection
                editSection(summary)
                lifecycleAndStatusSection(summary)
                moveSection

                if let message = model.actionErrorMessage {
                    Section {
                        Text(message).foregroundStyle(.red)
                            .accessibilityIdentifier("plants.detail.failure")
                    }
                }
            }
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

        case let .failed(message):
            VStack(alignment: .leading, spacing: 8) {
                Text(message)
                    .accessibilityIdentifier("plants.detail.loadFailure")
                Button(model.retryTitle) {
                    Task { await model.load() }
                }
            }
        }
    }

    private func summarySection(_ summary: PlantDetailSummary) -> some View {
        Section {
            Text(summary.displayName).font(.headline)
            Text(summary.groupingKindLabel).foregroundStyle(.secondary)
            if let quantity = summary.quantity {
                Text("\(model.quantityLabel): \(quantity)").foregroundStyle(.secondary)
            }
            if let syncStatusLabel = summary.syncStatusLabel {
                Text(syncStatusLabel)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("plants.detail.syncStatus")
            }
        }
    }

    /// Absent entirely for a `PlantDetailViewModel` built with no
    /// `photoAttachment` (see that property's own doc comment) — a real,
    /// working affordance whenever the composition root wires one, silently
    /// omitted otherwise rather than showing controls that could only ever
    /// fail.
    @ViewBuilder
    private var photoSection: some View {
        if let photoAttachment = model.photoAttachment {
            Section(model.photoSectionTitle) {
                PhotosPicker(model.photoPickButtonTitle, selection: $pickedPhotoItem, matching: .images)
                    .accessibilityIdentifier("plants.detail.photo.pick")

                if photoAttachment.status != .idle {
                    Text(model.photoStatusText)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("plants.detail.photo.status")

                    if photoAttachment.status.isRetryable, case .failed = photoAttachment.status {
                        Button(model.photoRetryButtonTitle) {
                            Task { await model.retryPhotoUpload() }
                        }
                        .accessibilityIdentifier("plants.detail.photo.retry")
                    }

                    Button(model.photoRemoveButtonTitle, role: .destructive) {
                        pickedPhotoItem = nil
                        Task { await model.discardPickedPhoto() }
                    }
                    .accessibilityIdentifier("plants.detail.photo.remove")
                }

                if model.photoAttachedConfirmation {
                    Text(model.photoSectionTitle)
                        .foregroundStyle(.green)
                        .accessibilityIdentifier("plants.detail.photo.attached")
                }

                if let message = model.photoAttachErrorMessage {
                    Text(message).foregroundStyle(.red)
                        .accessibilityIdentifier("plants.detail.photo.failure")
                }
            }
        }
    }

    /// Loads the picked item's real bytes and hands them to
    /// `PlantDetailViewModel.pickPhoto`, which durably persists them before
    /// any network call — see that method's own doc comment. A content type
    /// PhotosPicker did not declare (rare — it normally reports the exact
    /// UTType of the asset picked) falls back to `"image/jpeg"`, the most
    /// common real case, rather than failing the whole pick outright.
    private func loadAndAttach(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        await model.pickPhoto(data: data, contentType: contentType)
    }

    private func editSection(_ summary: PlantDetailSummary) -> some View {
        Section(model.editSectionTitle) {
            TextField(model.displayNameLabel, text: $model.editedDisplayName)
                .accessibilityIdentifier("plants.detail.displayNameField")

            taxonomyRow

            TextField(model.varietyLabelLabel, text: $model.editedVarietyLabel)
                .accessibilityIdentifier("plants.detail.varietyLabelField")

            // Only a row or a group tracks a quantity — an `.individual`
            // plant's server-side domain model rejects one outright
            // (`quantity.not_allowed`), the same gate `PlantsHomeView`'s add
            // form already applies on creation.
            if summary.groupingKind != .individual {
                TextField(model.quantityLabel, text: $model.editedQuantityText)
                    #if os(iOS)
                    .keyboardType(.numberPad)
                    #endif
                    .accessibilityIdentifier("plants.detail.quantityField")
            }

            Toggle(model.acquisitionDateToggleLabel, isOn: $model.editedHasAcquisitionDate)
                .accessibilityIdentifier("plants.detail.acquisitionDateToggle")
            if model.editedHasAcquisitionDate {
                DatePicker(
                    model.acquisitionDateLabel,
                    selection: $model.editedAcquisitionDate,
                    displayedComponents: .date
                )
                .accessibilityIdentifier("plants.detail.acquisitionDatePicker")

                Picker(model.acquisitionDateTypeLabel, selection: $model.editedAcquisitionDateType) {
                    ForEach(PlantAcquisitionDateType.allCases, id: \.self) { type in
                        Text(model.acquisitionDateTypeName(type)).tag(type)
                    }
                }
                .accessibilityIdentifier("plants.detail.acquisitionDateTypePicker")
            }

            TextField(model.conditionNoteLabel, text: $model.editedConditionNote, axis: .vertical)
                .accessibilityIdentifier("plants.detail.conditionNoteField")
            TextField(model.careGuidanceNoteLabel, text: $model.editedCareGuidanceNote, axis: .vertical)
                .accessibilityIdentifier("plants.detail.careGuidanceNoteField")

            Button(model.saveTitle) {
                Task { await model.saveDetails() }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.save")
        }
    }

    /// The detail screen's read-and-change affordance for an existing
    /// plant's identification, mirroring `PlantsHomeView`'s own
    /// `taxonomyRow` for the add-plant form — the same
    /// `TaxonomyReferencePickerView` sheet, the same search use case, wired
    /// to this screen's own `UpdatePlantDetails` call instead of `AddPlant`.
    private var taxonomyRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                model.isTaxonomyPickerPresented = true
            } label: {
                HStack {
                    Text(model.taxonomyLabel)
                    Spacer()
                    Text(model.selectedTaxonomySummary)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plants.detail.taxonomyRow")

            if model.editedTaxonomyReferenceId != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .accessibilityIdentifier("plants.detail.taxonomyClear")
            }
        }
    }

    private func lifecycleAndStatusSection(_ summary: PlantDetailSummary) -> some View {
        Section {
            Picker(model.lifecycleStageLabel, selection: lifecycleStageBinding(summary)) {
                ForEach(PlantLifecycleStage.allCases, id: \.self) { stage in
                    Text(model.lifecycleStageName(stage)).tag(stage)
                }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.lifecycleStagePicker")

            Picker(model.statusLabel, selection: statusBinding(summary)) {
                ForEach(PlantStatus.allCases, id: \.self) { status in
                    Text(model.statusName(status)).tag(status)
                }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.statusPicker")

            Button(model.deleteActionTitle, role: .destructive) {
                Task { await model.delete() }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.delete")
        }
    }

    private var moveSection: some View {
        Section(model.moveSectionTitle) {
            TextField(model.gardenAreaLabel, text: $model.editedGardenAreaMapObjectId)
                .accessibilityIdentifier("plants.detail.gardenAreaField")
            TextField(model.placementLabel, text: $model.editedPlacementMapObjectId)
                .accessibilityIdentifier("plants.detail.placementField")
            Text(model.mapObjectIdHint)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Button(model.moveSubmitTitle) {
                Task { await model.submitMove() }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.moveSubmit")
        }
    }

    private func lifecycleStageBinding(_ summary: PlantDetailSummary) -> Binding<PlantLifecycleStage> {
        Binding(
            get: { summary.lifecycleStage },
            set: { newValue in Task { await model.transitionLifecycleStage(to: newValue) } }
        )
    }

    private func statusBinding(_ summary: PlantDetailSummary) -> Binding<PlantStatus> {
        Binding(
            get: { summary.status },
            set: { newValue in Task { await model.setStatus(newValue) } }
        )
    }
}
