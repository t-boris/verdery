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
                                .foregroundStyle(Palette.accent)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Metrics.space3)
                                .background(
                                    RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                                        .fill(Tone.accent.quietFill)
                                )
                        }
                        .accessibilityIdentifier("plants.addFromPhoto.takePhoto")

                        if isCameraPermissionDeniedShown {
                            InlineMessage(model.cameraPermissionDeniedMessage, tone: .info)
                            Button(model.openSettingsButtonTitle) { CameraCapture.openSettings() }
                                .accessibilityIdentifier("plants.addFromPhoto.openSettings")
                        }
                    }

                    PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                        Label(pickTitle, systemImage: "photo.on.rectangle")
                            .font(Typography.body.weight(.medium))
                            .foregroundStyle(Palette.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Metrics.space3)
                            .background(
                                RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                                    .fill(Tone.accent.quietFill)
                            )
                    }
                    .accessibilityIdentifier("plants.addFromPhoto.pick")

                    if let status = model.photoAttachment?.status, status != .idle {
                        InlineMessage(model.photoStatusText, tone: .info)
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
                    } else {
                        Text(model.noConfidentMatchMessage)
                            .font(Typography.body)
                            .foregroundStyle(Palette.textMuted)
                            .accessibilityIdentifier("plants.addFromPhoto.noMatch")
                    }
                }
            }

            if identification?.suggestedTaxonomy != nil {
                Button(model.confirmButtonTitle) {
                    Task { await model.confirmSuggestion() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("plants.addFromPhoto.confirm")
            }

            Button(model.laterButtonTitle) { model.decideLater() }
                .accessibilityIdentifier("plants.addFromPhoto.later")
        }
    }

    private func loadAndAttach(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        await model.pickPhoto(data: data, contentType: contentType)
    }
}
