import CoreDesignSystem
import CoreMediaTransfer
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The property-plan upload screen (P6-PLAN iOS parity): pick a raster
/// image from Photos or a PDF/image from Files, local safety validation,
/// then the same durable background upload every photo attachment uses.
/// Honest states throughout: upload/processing progress from the shared
/// attachment status, an explicit PDF "cannot be previewed yet" notice, and
/// the processed raster's screen-preview derivative — never the original.
public struct GardenPlanUploadView: View {
    @State private var model: GardenPlanUploadViewModel
    @State private var pickedPhotoItem: PhotosPickerItem?
    @State private var isScannerPresented = false
    @State private var isFileImporterPresented = false

    /// The plan preview's ceiling, scaled with the reader's text size so the
    /// caption and controls below it are not pushed off screen at the
    /// accessibility sizes.
    @ScaledMetric(relativeTo: .body) private var previewMaxHeight: CGFloat = 320

    /// The Files picker's accepted types — `PlanDocumentValidation`'s
    /// allowlist as UTTypes: PDF plus the raster plan types.
    private static let importableTypes: [UTType] = [.pdf, .jpeg, .png, .webP, .heic, .heif]

    public init(model: GardenPlanUploadViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space4) {
                Text(model.description)
                    .font(FieldConsoleType.secondary.font)
                    .foregroundStyle(Palette.textMuted)

                pickerSection
                statusSection
                previewSection
            }
            .padding(Metrics.space4)
        }
        .navigationTitle(model.title)
        .inlineNavigationTitle()
        .screenBackground()
        .onChange(of: pickedPhotoItem) { _, newItem in
            guard let newItem else { return }
            Task { await loadAndAttach(newItem) }
        }
        .onChange(of: model.attachment.mediaId) { _, mediaId in
            guard mediaId != nil else { return }
            Task { await model.loadPreviewIfReady() }
        }
        #if canImport(VisionKit) && os(iOS)
            .fullScreenCover(isPresented: $isScannerPresented) {
                DocumentScanner(
                    onScan: { data in
                        isScannerPresented = false
                        Task {
                            await model.pickDocument(
                                data: data,
                                displayFilename: "plan.jpg",
                                contentType: "image/jpeg"
                            )
                        }
                    },
                    onCancel: { isScannerPresented = false }
                )
                .ignoresSafeArea()
            }
        #endif
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: Self.importableTypes
        ) { result in
            guard case let .success(url) = result else { return }
            Task { await attachFile(at: url) }
        }
    }

    /// Two ways in, as picture buttons rather than form rows: a plan arrives
    /// either as a photograph of a paper drawing or as a file somebody was
    /// emailed, and neither is more likely than the other.
    private var pickerSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                Label(model.selectImageTitle, systemImage: "photo.on.rectangle")
                    .font(FieldConsoleType.bodyStrong.font)
                    .foregroundStyle(Palette.text)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Metrics.space3)
                    .background(
                        RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                            .fill(Palette.surfaceSunken)
                    )
            }
            .accessibilityIdentifier("gardens.planUpload.pickPhoto")

            #if canImport(VisionKit) && os(iOS)
                // First of the three, because paper is how a plat actually
                // arrives. The scanner finds the page edges and flattens the
                // perspective — everything downstream (calibration, tracing,
                // text extraction) was designed for a flat rectangle, and a
                // photograph of a desk taken at an angle is not one.
                if DocumentScanner.isSupported {
                    Button {
                        isScannerPresented = true
                    } label: {
                        Label(model.scanDocumentTitle, systemImage: "doc.viewfinder")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("gardens.planUpload.scan")

                    Text(model.scanHint)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                }
            #endif

            Button {
                isFileImporterPresented = true
            } label: {
                Label(model.selectDocumentTitle, systemImage: "doc")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("gardens.planUpload.pickFile")

            if let message = model.validationErrorMessage {
                InlineMessage(message, tone: .negative)
                    .accessibilityIdentifier("gardens.planUpload.validationError")
            }
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        if model.attachment.status != .idle {
            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Text(model.statusText)
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityIdentifier("gardens.planUpload.status")

                    HStack(spacing: Metrics.space3) {
                        if model.attachment.status.isRetryable,
                            case .failed = model.attachment.status
                        {
                            CompactActionButton(
                                symbol: "arrow.clockwise", title: model.retryTitle
                            ) {
                                Task { await model.retry() }
                            }
                            .accessibilityIdentifier("gardens.planUpload.retry")
                        }

                        CompactActionButton(
                            symbol: "trash", title: model.removeTitle, tone: .negative
                        ) {
                            pickedPhotoItem = nil
                            Task { await model.discard() }
                        }
                        .accessibilityIdentifier("gardens.planUpload.remove")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var previewSection: some View {
        if model.isReady {
            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                Text(model.readyForMapText)
                    .font(FieldConsoleType.secondary.font)
                    .accessibilityIdentifier("gardens.planUpload.readyForMap")

                switch model.preview {
                case .none:
                    EmptyView()
                case .loading:
                    Text(model.previewLoadingText)
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                case .pdfDocument:
                    InlineMessage(model.pdfNoticeText, tone: .neutral)
                        .accessibilityIdentifier("gardens.planUpload.pdfNotice")
                case .unavailable:
                    InlineMessage(model.previewUnavailableText, tone: .warning)
                        .accessibilityIdentifier("gardens.planUpload.previewUnavailable")
                case let .ready(image):
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: previewMaxHeight)
                        .accessibilityIdentifier("gardens.planUpload.preview")
                }
                }
            }
        }
    }

    /// Loads the picked Photos item's real bytes — the same fallback
    /// content-type reasoning as `PlantDetailView.loadAndAttach`.
    private func loadAndAttach(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
        let fileExtension = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
        await model.pickDocument(
            data: data,
            displayFilename: "plan.\(fileExtension)",
            contentType: contentType
        )
    }

    /// Reads a Files-picked document. The URL is security-scoped outside
    /// this app's sandbox; access is explicitly bracketed.
    private func attachFile(at url: URL) async {
        let isScoped = url.startAccessingSecurityScopedResource()
        defer {
            if isScoped { url.stopAccessingSecurityScopedResource() }
        }

        guard let data = try? Data(contentsOf: url) else {
            model.reportReadFailure()
            return
        }
        let contentType =
            UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
            ?? "application/octet-stream"
        await model.pickDocument(
            data: data,
            displayFilename: url.lastPathComponent,
            contentType: contentType
        )
    }
}
