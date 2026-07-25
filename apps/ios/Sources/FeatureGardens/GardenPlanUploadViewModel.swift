import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreMediaTransfer
import CoreNetworking
import Foundation
import ImageIO
import Observation

/// The processed plan's preview state — honest about every branch: the
/// screen-preview DERIVATIVE is the display asset (plans are sensitive
/// originals, media-storage-and-processing.md section 11; the original is
/// never displayed), a PDF plan has no derivative yet (P6-WORKER-02's
/// documented deferral) and gets a stated notice instead of a broken image.
public enum PlanUploadPreviewState: Sendable {
    case none
    case loading
    case pdfDocument
    case unavailable
    case ready(CGImage)
}

/// The garden's property-plan upload screen (P6-PLAN iOS parity): select a
/// document (Photos or Files), validate it locally (accepted types, 50 MiB
/// — `PlanDocumentValidation`), and upload it privately with
/// `media_class: 'imported_plan'` through the same background-capable
/// `MediaUploadCoordinator` machinery every photo attachment uses
/// (`PhotoAttachmentController`, P6-IOS-01). Once processing succeeds the
/// plan is available to the map editor's background panel.
@MainActor
@Observable
public final class GardenPlanUploadViewModel {
    public private(set) var validationErrorMessage: String?
    public private(set) var preview: PlanUploadPreviewState = .none
    /// The content type of the document currently attached — what the PDF
    /// honest-messaging branch keys off.
    public private(set) var attachedContentType: String?

    public let attachment: PhotoAttachmentController

    let gardenId: String
    let mediaGateway: any MediaGateway
    let strings: LocalizedStrings
    /// Injected signed-URL byte fetcher, test-overridable for the preview
    /// path; the default mirrors `FeatureMap`'s loader — the signed
    /// download URL is a raw Cloud Storage URL, deliberately outside
    /// `HTTPTransport`.
    let fetchData: @Sendable (URL) async throws -> Data

    public init(
        gardenId: String,
        attachment: PhotoAttachmentController,
        mediaGateway: any MediaGateway,
        strings: LocalizedStrings,
        fetchData: (@Sendable (URL) async throws -> Data)? = nil
    ) {
        self.gardenId = gardenId
        self.attachment = attachment
        self.mediaGateway = mediaGateway
        self.strings = strings
        if let fetchData {
            self.fetchData = fetchData
        } else {
            // One session per screen, not per call — mirrors
            // `FeatureMap.LoadPlanBackgroundImage`'s identical reasoning.
            let session = URLSession(configuration: .ephemeral)
            self.fetchData = { url in try await session.data(from: url).0 }
        }
    }

    public var title: String { strings(.mediaPlanTitle) }
    public var description: String { strings(.mediaPlanDescription) }
    public var selectImageTitle: String { strings(.mediaPlanSelectImage) }
    public var selectDocumentTitle: String { strings(.mediaPlanSelectDocument) }
    public var retryTitle: String { strings(.mediaAttachRetryButton) }
    public var removeTitle: String { strings(.mediaAttachRemoveButton) }
    public var pdfNoticeText: String { strings(.mediaPlanPdfNoPreview) }
    public var readyForMapText: String { strings(.mediaPlanReadyForMap) }
    public var previewLoadingText: String { strings(.mediaPlanPreviewLoading) }
    public var previewUnavailableText: String { strings(.mediaPlanPreviewUnavailable) }

    /// The shared attachment-status wording, with one plan-specific
    /// override: `.ready` reads "Plan uploaded", not "Photo attached".
    public var statusText: String {
        if case .ready = attachment.status {
            return strings(.mediaPlanStatusReady)
        }
        return PhotoAttachmentStatusLocalization.text(for: attachment.status, strings: strings)
    }

    public var isPdfAttached: Bool {
        attachedContentType == PlanDocumentValidation.pdfContentType
    }

    public var isReady: Bool {
        if case .ready = attachment.status { return true }
        return false
    }

    /// Validates and, when valid, durably persists and enqueues the picked
    /// document — replacing whatever this screen was previously tracking,
    /// exactly like re-picking a photo does.
    public func pickDocument(data: Data, displayFilename: String, contentType: String) async {
        if let issue = PlanDocumentValidation.validate(contentType: contentType, byteCount: data.count) {
            validationErrorMessage = message(for: issue)
            return
        }

        validationErrorMessage = nil
        preview = .none
        attachedContentType = contentType
        await attachment.attach(data: data, displayFilename: displayFilename, contentType: contentType)
    }

    /// A picked file whose bytes could not be read at all (revoked
    /// security-scoped access, a provider error) — surfaced in the same
    /// slot as a validation failure, never silently swallowed.
    public func reportReadFailure() {
        validationErrorMessage = strings(.mediaPlanReadFailed)
    }

    public func retry() async {
        await attachment.retry()
    }

    public func discard() async {
        validationErrorMessage = nil
        preview = .none
        attachedContentType = nil
        await attachment.discard()
    }

    /// Called once the upload reaches `.ready`: resolves the processed
    /// plan's screen-preview derivative into a displayable image. A PDF
    /// never attempts a fetch — it has no derivative by design and gets its
    /// honest notice instead.
    public func loadPreviewIfReady() async {
        guard case let .ready(mediaId) = attachment.status else { return }
        if isPdfAttached {
            preview = .pdfDocument
            return
        }
        if case .ready = preview { return }

        preview = .loading
        do {
            let media = try await mediaGateway.getMediaStatus(gardenId: gardenId, mediaId: mediaId)
            guard let derivative = media.displayDerivative else {
                preview = .unavailable
                return
            }
            let access = try await mediaGateway.getMediaAccess(gardenId: gardenId, mediaId: derivative.mediaId)
            let data = try await fetchData(access.url)
            guard
                let source = CGImageSourceCreateWithData(data as CFData, nil),
                let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else {
                preview = .unavailable
                return
            }
            preview = .ready(image)
        } catch {
            preview = .unavailable
        }
    }

    private func message(for issue: PlanDocumentValidation.Issue) -> String {
        switch issue {
        case .unsupportedType:
            strings(.mediaPlanUnsupportedType)
        case .tooLarge:
            strings.string(
                .mediaPlanTooLarge,
                parameters: ["max": PlanDocumentValidation.maximumSizeText]
            )
        }
    }
}
