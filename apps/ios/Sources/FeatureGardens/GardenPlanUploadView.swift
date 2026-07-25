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
        Form {
            Section {
                Text(model.description)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            pickerSection
            statusSection
            previewSection
        }
        .navigationTitle(model.title)
        .onChange(of: pickedPhotoItem) { _, newItem in
            guard let newItem else { return }
            Task { await loadAndAttach(newItem) }
        }
        .onChange(of: model.attachment.mediaId) { _, mediaId in
            guard mediaId != nil else { return }
            Task { await model.loadPreviewIfReady() }
        }
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: Self.importableTypes
        ) { result in
            guard case let .success(url) = result else { return }
            Task { await attachFile(at: url) }
        }
    }

    private var pickerSection: some View {
        Section {
            PhotosPicker(model.selectImageTitle, selection: $pickedPhotoItem, matching: .images)
                .accessibilityIdentifier("gardens.planUpload.pickPhoto")

            Button(model.selectDocumentTitle) {
                isFileImporterPresented = true
            }
            .accessibilityIdentifier("gardens.planUpload.pickFile")

            if let message = model.validationErrorMessage {
                Text(message)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("gardens.planUpload.validationError")
            }
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        if model.attachment.status != .idle {
            Section {
                Text(model.statusText)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("gardens.planUpload.status")

                if model.attachment.status.isRetryable, case .failed = model.attachment.status {
                    Button(model.retryTitle) {
                        Task { await model.retry() }
                    }
                    .accessibilityIdentifier("gardens.planUpload.retry")
                }

                Button(model.removeTitle, role: .destructive) {
                    pickedPhotoItem = nil
                    Task { await model.discard() }
                }
                .accessibilityIdentifier("gardens.planUpload.remove")
            }
        }
    }

    @ViewBuilder
    private var previewSection: some View {
        if model.isReady {
            Section {
                Text(model.readyForMapText)
                    .font(.footnote)
                    .accessibilityIdentifier("gardens.planUpload.readyForMap")

                switch model.preview {
                case .none:
                    EmptyView()
                case .loading:
                    Text(model.previewLoadingText)
                        .foregroundStyle(.secondary)
                case .pdfDocument:
                    Text(model.pdfNoticeText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("gardens.planUpload.pdfNotice")
                case .unavailable:
                    Text(model.previewUnavailableText)
                        .foregroundStyle(.secondary)
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
