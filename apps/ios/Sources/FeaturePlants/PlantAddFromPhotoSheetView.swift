import CoreDesignSystem
import CoreDomain
import CoreMediaTransfer
import PhotosUI
import SwiftUI

/// The "Add plant from photo" sheet (ADR-0015): pick a photo, wait for the
/// plant to be created and identified, then review the AI's suggestion.
///
/// Structured like `PlantAddSheetView` (a `NavigationStack` with a
/// cancellation-action Close button) for the picking step, and like
/// `PlantDetailView`'s photo section for the pick/upload UI itself — see
/// each view's own doc comment for why those shapes were chosen.
public struct PlantAddFromPhotoSheetView: View {
    @State private var model: PlantAddFromPhotoViewModel
    @State private var pickedPhotoItem: PhotosPickerItem?
    @State private var isCameraPresented = false
    @State private var isCameraPermissionDeniedShown = false
    let onFinish: (String?) -> Void

    public init(model: PlantAddFromPhotoViewModel, onFinish: @escaping (String?) -> Void) {
        _model = State(wrappedValue: model)
        self.onFinish = onFinish
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    content
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.closeTitle) { onFinish(nil) }
                }
            }
            .onChange(of: pickedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task { await loadAndAttach(newItem) }
            }
            .onChange(of: model.photoAttachment?.mediaId) { _, mediaId in
                guard let mediaId else { return }
                Task { await model.photoReady(mediaId: mediaId) }
            }
            .onChange(of: model.state) { _, newState in
                if case let .done(plantId) = newState {
                    onFinish(plantId)
                }
            }
            .cameraCapture(isPresented: $isCameraPresented) { data, contentType in
                Task { await model.pickPhoto(data: data, contentType: contentType) }
            }
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
        case .pickingPhoto:
            pickSection

        case .submittingIdentification:
            LoadingStateView(model.submittingMessage)
                .accessibilityIdentifier("plants.addFromPhoto.submitting")

        case .reviewing(_, let identification):
            reviewSection(identification)

        case .confirming:
            LoadingStateView(model.submittingMessage)
                .accessibilityIdentifier("plants.addFromPhoto.confirming")

        case .done:
            EmptyView()

        case .failed:
            pickSection
        }
    }

    private var pickSection: some View {
        let pickTitle = model.pickButtonTitle

        return VStack(alignment: .leading, spacing: Metrics.space3) {
            Text(model.hint)
                .font(Typography.body)
                .foregroundStyle(Palette.textMuted)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    if CameraCapture.isAvailable {
                        Button(action: takePhoto) {
                            Label(model.takePhotoButtonTitle, systemImage: "camera.viewfinder")
                                .font(Typography.body.weight(.medium))
                                // Genuine interaction, and the one this sheet
                                // exists for: photographing the plant is the
                                // action, choosing a file is the fallback.
                                .foregroundStyle(Palette.interaction)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Metrics.space3)
                                .background(
                                    RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                                        .fill(Palette.interactionQuiet)
                                )
                        }
                        .accessibilityIdentifier("plants.addFromPhoto.takePhoto")

                        if isCameraPermissionDeniedShown {
                            InlineMessage(model.cameraPermissionDeniedMessage, tone: .neutral)
                            Button(model.openSettingsButtonTitle) { CameraCapture.openSettings() }
                                .accessibilityIdentifier("plants.addFromPhoto.openSettings")
                        }
                    }

                    PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                        Label(pickTitle, systemImage: "photo.on.rectangle")
                            .font(Typography.body.weight(.medium))
                            .foregroundStyle(Palette.text)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Metrics.space3)
                            .background(
                                RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                                    .fill(Palette.surfaceSunken)
                            )
                    }
                    .accessibilityIdentifier("plants.addFromPhoto.pick")

                    if let status = model.photoAttachment?.status, status != .idle {
                        InlineMessage(model.photoStatusText, tone: .neutral)
                            .accessibilityIdentifier("plants.addFromPhoto.status")

                        if status.isRetryable, case .failed = status {
                            CompactActionButton(symbol: "arrow.clockwise", title: model.retryButtonTitle) {
                                Task { await model.retryPhotoUpload() }
                            }
                            .accessibilityIdentifier("plants.addFromPhoto.retry")
                        }
                    }
                }
            }

            if let message = model.errorMessage {
                InlineMessage(message)
                    .accessibilityIdentifier("plants.addFromPhoto.failure")
            }
        }
    }

    @ViewBuilder
    private func reviewSection(_ identification: PlantIdentification?) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            SectionEyebrow(symbol: PlantSymbols.taxonomy, title: model.suggestedLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    if let suggestion = identification?.suggestedTaxonomy, let identification {
                        Text(model.suggestionDisplayName(suggestion))
                            .font(Typography.body.weight(.semibold))
                            .accessibilityIdentifier("plants.addFromPhoto.suggestion")
                        Text("\(model.confidenceLabel): \(model.confidenceText(identification.confidenceScore))")
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    } else if let identification, let commonName = identification.suggestedCommonName {
                        Text(model.rawSuggestionDisplayName(
                            commonName: commonName,
                            scientificName: identification.suggestedScientificName
                        ))
                            .font(Typography.body.weight(.semibold))
                            .accessibilityIdentifier("plants.addFromPhoto.suggestion")
                        Text("\(model.confidenceLabel): \(model.confidenceText(identification.confidenceScore))")
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                        Text(model.unlistedSuggestionNote)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                            .accessibilityIdentifier("plants.addFromPhoto.unlistedNote")
                    } else {
                        Text(model.noConfidentMatchMessage)
                            .font(Typography.body)
                            .foregroundStyle(Palette.textMuted)
                            .accessibilityIdentifier("plants.addFromPhoto.noMatch")
                    }

                    if let identification {
                        suggestionDetailRows(identification)
                    }
                }
            }

            HStack(spacing: Metrics.space2) {
                if identification?.hasConfirmableSuggestion == true {
                    Button(model.confirmButtonTitle) {
                        Task { await model.confirmSuggestion() }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("plants.addFromPhoto.confirm")
                }

                recordObservationButton(identification)
            }

            if model.observationSuggestion?.recordedConfirmation == true {
                InlineMessage(model.observationRecordedMessage, tone: .positive)
                    .accessibilityIdentifier("plants.addFromPhoto.observationRecorded")
            }
            if let message = model.observationSuggestion?.errorMessage {
                InlineMessage(message)
                    .accessibilityIdentifier("plants.addFromPhoto.observationFailure")
            }

            Button(model.laterButtonTitle) { model.decideLater() }
                .accessibilityIdentifier("plants.addFromPhoto.later")
        }
    }

    /// Independent of `hasConfirmableSuggestion` — a condition/care guess is
    /// meaningful on its own even when the species guess had no confident
    /// catalog match. `plant` comes from `model.state`'s own `.reviewing`
    /// case, which owns the plant id `RecordObservationFromIdentification`
    /// needs.
    @ViewBuilder
    private func recordObservationButton(_ identification: PlantIdentification?) -> some View {
        if let observationSuggestion = model.observationSuggestion,
            let identification, identification.suggestedConditionNote != nil,
            case let .reviewing(plant, _) = model.state
        {
            Button(model.recordObservationButtonTitle) {
                Task {
                    await observationSuggestion.record(
                        gardenId: model.gardenId, plantId: plant.id, identificationId: identification.id
                    )
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(observationSuggestion.isRecording)
            .accessibilityIdentifier("plants.addFromPhoto.recordObservation")
        }
    }

    /// Variety, growth stage, condition, care-guidance, and acquisition-date
    /// guesses, shown alongside the name suggestion above when present —
    /// supplementary display only, never a condition for whether Confirm is
    /// enabled (`hasConfirmableSuggestion` stays keyed on taxonomy/common-name
    /// presence). Each an icon + label + value row, the same treatment
    /// `PlantIdentificationBannerView.detailRows` gives the identical rows on
    /// the plant detail screen's own banner.
    @ViewBuilder
    private func suggestionDetailRows(_ identification: PlantIdentification) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            if let variety = identification.suggestedVarietyLabel {
                detailRow(PlantSymbols.variety, model.varietyLabel, variety, identifier: "plants.addFromPhoto.variety")
            }
            if let stage = identification.suggestedLifecycleStage {
                detailRow(
                    PlantSymbols.lifecycleStage(stage), model.growthStageLabel, model.growthStageName(stage),
                    identifier: "plants.addFromPhoto.growthStage"
                )
            }
            if let condition = identification.suggestedConditionNote {
                detailRow(PlantSymbols.condition, model.conditionLabel, condition, identifier: "plants.addFromPhoto.condition")
            }
            if let careGuidance = identification.suggestedCareGuidanceNote {
                detailRow(
                    PlantSymbols.careGuidance, model.careGuidanceLabel, careGuidance,
                    identifier: "plants.addFromPhoto.careGuidance"
                )
            }
            if let acquisitionDate = identification.suggestedAcquisitionDate {
                detailRow(
                    PlantSymbols.acquisitionDateGuess, model.acquisitionDateLabel, acquisitionDate,
                    identifier: "plants.addFromPhoto.acquisitionDate"
                )
            }
        }
    }

    private func detailRow(_ symbol: String, _ label: String, _ value: String, identifier: String) -> some View {
        HStack(alignment: .top, spacing: Metrics.space2) {
            Image(systemName: symbol)
                .font(Typography.body)
                .foregroundStyle(Palette.textMuted)
                .frame(width: Metrics.space5)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Metrics.space1) {
                Text(label)
                    .font(Typography.detail)
                    .foregroundStyle(Palette.textMuted)
                Text(value)
                    .font(Typography.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityIdentifier(identifier)
    }

    private func loadAndAttach(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        await model.pickPhoto(data: data, contentType: contentType)
    }
}
