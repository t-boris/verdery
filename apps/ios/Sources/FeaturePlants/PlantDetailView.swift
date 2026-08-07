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
    @State var model: PlantDetailViewModel
    @State var pickedPhotoItem: PhotosPickerItem?
    @State var isDeleteConfirmationPresented = false
    @State var isCameraPresented = false
    @State var isCameraPermissionDeniedShown = false
    /// The printable label — see ``PlantLabelSheetView`` for why a plant has
    /// one at all.
    @State private var isLabelPresented = false
    @Environment(\.dismiss) private var dismiss

    public init(model: PlantDetailViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .secondaryAction) {
                    Button {
                        isLabelPresented = true
                    } label: {
                        Label(model.labelSheetTitle, systemImage: "qrcode")
                    }
                    .accessibilityIdentifier("plants.detail.openLabel")
                }
            }
            .sheet(isPresented: $isLabelPresented) {
                PlantLabelSheetView(
                    link: PlantDeepLink(gardenId: model.gardenId, plantId: model.plantId),
                    plantName: model.editedDisplayName,
                    strings: model.strings,
                    close: { isLabelPresented = false }
                )
                .presentationDetents([.large])
            }
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
                    PlantIdentificationBannerView(model: model)
                    stageSection(summary)
                    photoGallerySection
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
            // Attached here, at the same level as the two `.sheet`s above,
            // rather than nested inside `deleteSection` (a leaf computed
            // property several levels down) — a live retest found the dialog
            // itself would open but confirming it never reached the network,
            // and this is the one structural difference from the two
            // known-working presentations on this exact screen.
            .confirmationDialog(
                model.deleteActionTitle,
                isPresented: $isDeleteConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button(model.deleteActionTitle, role: .destructive) {
                    Task {
                        await model.delete()
                        if model.actionErrorMessage == nil {
                            Haptics.play(.warning)
                            dismiss()
                        }
                    }
                }
                Button(model.closeTitle, role: .cancel) {}
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
    func chipFlow<Data: RandomAccessCollection, ID: Hashable, Content: View>(
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
    /// `photoGallery` (see that property's own doc comment) — the same
    /// "real, working affordance or nothing" rule `photoSection` itself
    /// follows.
    @ViewBuilder
    private var photoGallerySection: some View {
        if let photoGallery = model.photoGallery {
            PlantPhotoGalleryView(photos: photoGallery.photos, title: model.photoGalleryTitle)
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
                                    .foregroundStyle(Palette.interaction)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, Metrics.space3)
                                    .background(
                                        RoundedRectangle(
                                            cornerRadius: Metrics.radiusControl, style: .continuous
                                        )
                                        .fill(Palette.interactionQuiet)
                                    )
                            }
                            .accessibilityIdentifier("plants.detail.photo.takePhoto")

                            if isCameraPermissionDeniedShown {
                                InlineMessage(model.cameraPermissionDeniedMessage, tone: .neutral)
                                Button(model.openSettingsButtonTitle) { CameraCapture.openSettings() }
                                    .accessibilityIdentifier("plants.detail.photo.openSettings")
                            }
                        }

                        PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                            Label(pickTitle, systemImage: "photo.on.rectangle")
                                .font(Typography.body.weight(.medium))
                                .foregroundStyle(Palette.text)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Metrics.space3)
                                .background(
                                    RoundedRectangle(
                                        cornerRadius: Metrics.radiusControl, style: .continuous
                                    )
                                    .fill(Palette.surfaceSunken)
                                )
                        }
                        .accessibilityIdentifier("plants.detail.photo.pick")

                        if photoAttachment.status != .idle {
                            InlineMessage(model.photoStatusText, tone: .neutral)
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

    /// A small icon caption above a field's own control — the edit form's
    /// counterpart to `SectionEyebrow` (which labels a whole group, not one
    /// field) and to the web client's `DetailRow` (icon + label above value).
    /// The caption is hidden from VoiceOver: it is decorative reinforcement
    /// of the control's own accessible name (its placeholder or label text),
    /// never the sole source of that name — the same rule
    /// `taxonomyRow`/`mapObjectRow`'s own trailing chevrons already follow.
    func iconField<Content: View>(
        _ symbol: String,
        _ label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            Label(label, systemImage: symbol)
                .font(Typography.detail)
                .foregroundStyle(Palette.textMuted)
                .accessibilityHidden(true)
            content()
        }
    }

}
