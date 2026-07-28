import CoreDesignSystem
import CoreDomain
import CoreMediaTransfer
import PhotosUI
import SwiftUI

/// A single plant's detail screen.
///
/// The screen now opens with the plant itself: a large lifecycle-stage
/// medallion, the name in the display face, and its stage, status, grouping,
/// and quantity as chips — everything a gardener wants to know before deciding
/// whether to change anything. Lifecycle stage and status, previously two
/// `Picker` wheels, are chip rows, so moving a plant from "growing" to
/// "flowering" is one tap on a recognisable symbol.
///
/// Deleting confirms first; it did not, and it sat two rows below a picker
/// people were meant to scroll through.
///
/// Editing keeps its own section, unchanged in what it collects.
public struct PlantDetailView: View {
    @State private var model: PlantDetailViewModel
    @State private var pickedPhotoItem: PhotosPickerItem?
    @State private var isDeleteConfirmationPresented = false
    @State private var isCameraPresented = false
    @State private var isCameraPermissionDeniedShown = false

    public init(model: PlantDetailViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .task { await model.load() }
            .onChange(of: pickedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task { await loadAndAttach(newItem) }
            }
            .onChange(of: model.photoAttachment?.mediaId) { _, mediaId in
                guard let mediaId else { return }
                Task { await model.attachPickedPhoto(mediaId: mediaId) }
            }
            .cameraCapture(isPresented: $isCameraPresented) { data, contentType in
                Task { await model.pickPhoto(data: data, contentType: contentType) }
            }
    }

    private func takePhoto() {
        if CameraCapture.authorizationStatus == .denied {
            isCameraPermissionDeniedShown = true
        } else {
            isCameraPermissionDeniedShown = false
            isCameraPresented = true
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("plants.detail.loading")

        case let .loaded(summary):
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    summaryCard(summary)
                    identificationSection
                    stageSection(summary)
                    photoSection
                    editSection(summary)
                    moveSection
                    deleteSection

                    if let message = model.actionErrorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("plants.detail.failure")
                    }
                }
                .padding(Metrics.space4)
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
            FailureStateView(
                message: message,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("plants.detail.loadFailure")
        }
    }

    private func summaryCard(_ summary: PlantDetailSummary) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                HStack(spacing: Metrics.space3) {
                    IconMedallion(
                        symbol: PlantSymbols.lifecycleStage(summary.lifecycleStage),
                        label: summary.lifecycleStageLabel,
                        tone: PlantSymbols.lifecycleTone(summary.lifecycleStage),
                        isLarge: true
                    )
                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(summary.displayName)
                            .font(Typography.title)
                            .foregroundStyle(Palette.text)
                        Text(summary.groupingKindLabel)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                }

                HStack(spacing: Metrics.space2) {
                    Chip(
                        symbol: PlantSymbols.lifecycleStage(summary.lifecycleStage),
                        label: summary.lifecycleStageLabel,
                        tone: PlantSymbols.lifecycleTone(summary.lifecycleStage)
                    )
                    Chip(
                        symbol: PlantSymbols.status(summary.status),
                        label: summary.statusLabel,
                        tone: PlantSymbols.statusTone(summary.status)
                    )
                    if let quantity = summary.quantity {
                        Chip(
                            symbol: PlantSymbols.quantity,
                            label: "\(model.quantityLabel): \(quantity)",
                            tone: .neutral
                        )
                    }
                    if let syncStatusLabel = summary.syncStatusLabel {
                        StatusGlyph(
                            symbol: PlantSymbols.pendingSync,
                            label: syncStatusLabel,
                            tone: .warning
                        )
                        .accessibilityIdentifier("plants.detail.syncStatus")
                    }
                    Spacer(minLength: 0)
                }
                .lineLimit(1)
            }
        }
    }

    /// Shown only when `AddPlantFromPhoto` (ADR-0015) left a suggestion this
    /// plant has not yet confirmed or dismissed — absent entirely otherwise,
    /// the same "real, working affordance or nothing" rule `photoSection`
    /// already follows for a `PlantDetailViewModel` built with no
    /// `photoAttachment`. Only shown for a suggestion that named a real
    /// candidate: confirming a "no confident match" identification has
    /// nothing for the reader to act on here.
    @ViewBuilder
    private var identificationSection: some View {
        if let identification = model.pendingIdentification, let suggestion = identification.suggestedTaxonomy {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: PlantSymbols.taxonomy, title: model.identificationSuggestedLabel)

                SurfaceCard(tone: .accent) {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        Text(model.identificationPendingBanner)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                        Text(model.identificationSuggestionDisplayName(suggestion))
                            .font(Typography.body.weight(.semibold))
                            .accessibilityIdentifier("plants.detail.identification.suggestion")
                        Text(
                            "\(model.identificationConfidenceLabel): "
                                + model.identificationConfidenceText(identification.confidenceScore)
                        )
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)

                        Button(model.identificationConfirmButtonTitle) {
                            Task { await model.confirmPendingIdentification() }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("plants.detail.identification.confirm")
                    }
                }
            }
        }
    }

    /// Lifecycle stage and status, as two rows of chips.
    ///
    /// These were `Picker`s bound to a `set` that fired a command. They still
    /// fire the same command; what changed is that all eight stages are
    /// visible at once as distinct symbols, so the current one and the next
    /// one are both a glance away instead of behind a wheel.
    private func stageSection(_ summary: PlantDetailSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: "arrow.triangle.turn.up.right.diamond", title: model.lifecycleStageLabel)
                chipFlow(PlantLifecycleStage.allCases, id: \.self) { stage in
                    PlantChoiceChip(
                        symbol: PlantSymbols.lifecycleStage(stage),
                        label: model.lifecycleStageName(stage),
                        isSelected: summary.lifecycleStage == stage
                    ) {
                        Task { await model.transitionLifecycleStage(to: stage) }
                    }
                }
                .accessibilityIdentifier("plants.detail.lifecycleStagePicker")
            }

            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: "heart.text.square", title: model.statusLabel)
                chipFlow(PlantStatus.allCases, id: \.self) { status in
                    PlantChoiceChip(
                        symbol: PlantSymbols.status(status),
                        label: model.statusName(status),
                        isSelected: summary.status == status
                    ) {
                        Task { await model.setStatus(status) }
                    }
                }
                .accessibilityIdentifier("plants.detail.statusPicker")
            }
        }
        .disabled(model.isSubmitting)
    }

    /// A horizontally scrolling row of chips.
    ///
    /// Horizontal scrolling rather than wrapping so the row's height is stable
    /// as the reader's text size grows — a wrapped row of eight chips becomes
    /// four lines at an accessibility size and pushes everything below it off
    /// the screen.
    private func chipFlow<Data: RandomAccessCollection, ID: Hashable, Content: View>(
        _ data: Data,
        id: KeyPath<Data.Element, ID>,
        @ViewBuilder content: @escaping (Data.Element) -> Content
    ) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Metrics.space2) {
                ForEach(data, id: id, content: content)
            }
            .padding(.vertical, Metrics.space1)
        }
    }

    /// Absent entirely for a `PlantDetailViewModel` built with no
    /// `photoAttachment` (see that property's own doc comment) — a real,
    /// working affordance whenever the composition root wires one, silently
    /// omitted otherwise rather than showing controls that could only fail.
    @ViewBuilder
    private var photoSection: some View {
        if let photoAttachment = model.photoAttachment {
            let pickTitle = model.photoPickButtonTitle

            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: PlantSymbols.photo, title: model.photoSectionTitle)

                SurfaceCard {
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        if CameraCapture.isAvailable {
                            Button(action: takePhoto) {
                                Label(model.takePhotoButtonTitle, systemImage: "camera.viewfinder")
                                    .font(Typography.body.weight(.medium))
                                    .foregroundStyle(Palette.accent)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, Metrics.space3)
                                    .background(
                                        RoundedRectangle(
                                            cornerRadius: Metrics.radiusMedium, style: .continuous
                                        )
                                        .fill(Tone.accent.quietFill)
                                    )
                            }
                            .accessibilityIdentifier("plants.detail.photo.takePhoto")

                            if isCameraPermissionDeniedShown {
                                InlineMessage(model.cameraPermissionDeniedMessage, tone: .info)
                                Button(model.openSettingsButtonTitle) { CameraCapture.openSettings() }
                                    .accessibilityIdentifier("plants.detail.photo.openSettings")
                            }
                        }

                        PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                            Label(pickTitle, systemImage: "photo.on.rectangle")
                                .font(Typography.body.weight(.medium))
                                .foregroundStyle(Palette.accent)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Metrics.space3)
                                .background(
                                    RoundedRectangle(
                                        cornerRadius: Metrics.radiusMedium, style: .continuous
                                    )
                                    .fill(Tone.accent.quietFill)
                                )
                        }
                        .accessibilityIdentifier("plants.detail.photo.pick")

                        if photoAttachment.status != .idle {
                            InlineMessage(model.photoStatusText, tone: .info)
                                .accessibilityIdentifier("plants.detail.photo.status")

                            HStack(spacing: Metrics.space2) {
                                if photoAttachment.status.isRetryable,
                                    case .failed = photoAttachment.status
                                {
                                    CompactActionButton(
                                        symbol: "arrow.clockwise",
                                        title: model.photoRetryButtonTitle
                                    ) {
                                        Task { await model.retryPhotoUpload() }
                                    }
                                    .accessibilityIdentifier("plants.detail.photo.retry")
                                }

                                CompactActionButton(
                                    symbol: "trash",
                                    title: model.photoRemoveButtonTitle,
                                    tone: .negative
                                ) {
                                    pickedPhotoItem = nil
                                    Task { await model.discardPickedPhoto() }
                                }
                                .accessibilityIdentifier("plants.detail.photo.remove")
                            }
                        }

                        if model.photoAttachedConfirmation {
                            InlineMessage(model.photoSectionTitle, tone: .positive)
                                .accessibilityIdentifier("plants.detail.photo.attached")
                        }

                        if let message = model.photoAttachErrorMessage {
                            InlineMessage(message)
                                .accessibilityIdentifier("plants.detail.photo.failure")
                        }
                    }
                }
            }
        }
    }

    /// Loads the picked item's real bytes and hands them to
    /// `PlantDetailViewModel.pickPhoto`, which durably persists them before
    /// any network call. A content type PhotosPicker did not declare falls
    /// back to `"image/jpeg"`, the most common real case, rather than failing
    /// the whole pick outright.
    private func loadAndAttach(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        await model.pickPhoto(data: data, contentType: contentType)
    }

    private func editSection(_ summary: PlantDetailSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "pencil", title: model.editSectionTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.displayNameLabel, text: $model.editedDisplayName)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("plants.detail.displayNameField")

                    taxonomyRow

                    TextField(model.varietyLabelLabel, text: $model.editedVarietyLabel)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("plants.detail.varietyLabelField")

                    // Only a row or a group tracks a quantity — an
                    // `.individual` plant's server-side domain model rejects
                    // one outright (`quantity.not_allowed`), the same gate the
                    // add form already applies on creation.
                    if summary.groupingKind != .individual {
                        TextField(model.quantityLabel, text: $model.editedQuantityText)
                            .textFieldStyle(.roundedBorder)
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

                        HStack(spacing: Metrics.space2) {
                            ForEach(PlantAcquisitionDateType.allCases, id: \.self) { type in
                                PlantChoiceChip(
                                    symbol: PlantSymbols.acquisitionDateType(type),
                                    label: model.acquisitionDateTypeName(type),
                                    isSelected: model.editedAcquisitionDateType == type
                                ) {
                                    model.editedAcquisitionDateType = type
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .accessibilityIdentifier("plants.detail.acquisitionDateTypePicker")
                    }

                    TextField(
                        model.conditionNoteLabel, text: $model.editedConditionNote, axis: .vertical
                    )
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)
                    .accessibilityIdentifier("plants.detail.conditionNoteField")

                    TextField(
                        model.careGuidanceNoteLabel,
                        text: $model.editedCareGuidanceNote,
                        axis: .vertical
                    )
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...4)
                    .accessibilityIdentifier("plants.detail.careGuidanceNoteField")

                    Button {
                        Task {
                            await model.saveDetails()
                            Haptics.play(model.actionErrorMessage == nil ? .success : .failure)
                        }
                    } label: {
                        Label(model.saveTitle, systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isSubmitting)
                    .accessibilityIdentifier("plants.detail.save")
                }
            }
            .tint(Palette.accent)
        }
    }

    /// The detail screen's read-and-change affordance for an existing plant's
    /// identification, mirroring the add sheet's own taxonomy row.
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
            .accessibilityIdentifier("plants.detail.taxonomyRow")

            if model.editedTaxonomyReferenceId != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .font(Typography.detail)
                    .tint(Palette.negative)
                    .accessibilityIdentifier("plants.detail.taxonomyClear")
            }
        }
    }

    private var moveSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: PlantSymbols.placement, title: model.moveSectionTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.gardenAreaLabel, text: $model.editedGardenAreaMapObjectId)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("plants.detail.gardenAreaField")
                    TextField(model.placementLabel, text: $model.editedPlacementMapObjectId)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("plants.detail.placementField")
                    InlineMessage(model.mapObjectIdHint, tone: .info)

                    Button {
                        Task {
                            await model.submitMove()
                            Haptics.play(model.actionErrorMessage == nil ? .success : .failure)
                        }
                    } label: {
                        Label(model.moveSubmitTitle, systemImage: "arrow.right")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.isSubmitting)
                    .accessibilityIdentifier("plants.detail.moveSubmit")
                }
            }
        }
    }

    /// Deleting a plant is irreversible from here, so it confirms — it used to
    /// be a bare destructive row inside the same section as two pickers.
    private var deleteSection: some View {
        Button {
            isDeleteConfirmationPresented = true
        } label: {
            Label(model.deleteActionTitle, systemImage: "trash")
        }
        .buttonStyle(SecondaryButtonStyle())
        .disabled(model.isSubmitting)
        .accessibilityIdentifier("plants.detail.delete")
        .confirmationDialog(
            model.deleteActionTitle,
            isPresented: $isDeleteConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button(model.deleteActionTitle, role: .destructive) {
                Task {
                    await model.delete()
                    Haptics.play(.warning)
                }
            }
            Button(model.closeTitle, role: .cancel) {}
        }
    }
}
