import CoreDomain
import CoreGraphics
import CoreNetworking
import Foundation
import ImageIO

/// A decoded plan raster the canvas can draw, with the pixel dimensions the
/// calibration flow measures the page aspect ratio from.
///
/// `@unchecked Sendable` carries one auditable claim: `CGImage` is
/// immutable after creation (Core Graphics documents no mutating API on
/// it), so sharing one instance across actors cannot race.
public struct PlanBackgroundImage: @unchecked Sendable, Identifiable {
    /// The derivative media record's own id — stable identity for caching.
    public let id: String
    public let image: CGImage
    public let pixelWidth: Int
    public let pixelHeight: Int

    /// Page height / page width — the calibration input the client
    /// measures from the displayed raster (every derivative preserves the
    /// page's aspect ratio, so any rendition yields the same value).
    public var pageAspectRatio: Double { Double(pixelHeight) / Double(pixelWidth) }

    public init(id: String, image: CGImage, pixelWidth: Int, pixelHeight: Int) {
        self.id = id
        self.image = image
        self.pixelWidth = pixelWidth
        self.pixelHeight = pixelHeight
    }
}

/// One plan's display-image resolution state, mirroring the web's
/// `use-background-image.ts` vocabulary exactly: `unavailable` is the
/// honest terminal state for a plan with nothing displayable — every PDF
/// plan today (P6-WORKER-02's documented deferral), a plan whose processing
/// failed, or a fetch/decode failure.
public enum PlanBackgroundImageState: Sendable {
    case loading
    case unavailable
    case ready(PlanBackgroundImage)

    public var readyImage: PlanBackgroundImage? {
        if case let .ready(image) = self { return image }
        return nil
    }
}

/// Lists a garden's placeable plan documents: `ListGardenMedia` filtered to
/// `imported_plan`, first page only (50 most recent — the same deliberate
/// scope as the web picker; a pagination UI waits for a real garden to
/// outgrow it, `tasks/todo.md` Stage 9).
public struct ListGardenPlanMedia: Sendable {
    /// Matches the contract's maximum `Limit`; one page of 50 recent plans
    /// is the whole picker today.
    static let pageLimit = 50

    private let gateway: any MediaGateway

    public init(gateway: any MediaGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String) async throws -> [Media] {
        let result = try await gateway.listGardenMedia(
            gardenId: gardenId,
            mediaClass: .importedPlan,
            cursor: nil,
            limit: Self.pageLimit
        )
        return result.items
    }
}

/// Resolves an imported background's display image (P6-PLAN-01):
/// `GetMediaStatus` on the plan media id -> its `derivatives` array -> the
/// screen-preview derivative's own id (thumbnail fallback) ->
/// `GetMediaAccess` signed URL -> downloaded bytes -> a decoded `CGImage`.
///
/// The screen preview (1,600 px) is the display derivative, not the
/// 4,096 px high-resolution review image: at the map editor's zoom range a
/// background underlay never needs more. The server-side tile pyramid is
/// deliberately NOT consumed — see docs/development/deferred-capabilities.md
/// ("Plan tile consumption").
public struct LoadPlanBackgroundImage: Sendable {
    /// Fetches raw bytes from a signed URL. Injected so tests exercise the
    /// derivative-selection and decode logic without a network; the default
    /// is a plain ephemeral `URLSession` — the signed download URL is a raw
    /// Cloud Storage URL, never an API operation, so it deliberately does
    /// not go through `HTTPTransport` (the same boundary
    /// `MediaUploadCoordinator` draws for upload bytes).
    public typealias DataFetcher = @Sendable (URL) async throws -> Data

    private let gateway: any MediaGateway
    private let fetchData: DataFetcher

    public init(gateway: any MediaGateway, fetchData: DataFetcher? = nil) {
        self.gateway = gateway
        if let fetchData {
            self.fetchData = fetchData
        } else {
            // One session per use-case instance, not per call — a
            // `URLSession` is a real resource that is never implicitly
            // invalidated.
            let session = URLSession(configuration: .ephemeral)
            self.fetchData = { url in try await session.data(from: url).0 }
        }
    }

    /// `unavailable` (not an error) when the plan has no display derivative
    /// — the web hook's exact posture; a thrown error means the resolution
    /// itself failed and may succeed on retry.
    public func callAsFunction(gardenId: String, planMediaId: String) async throws -> PlanBackgroundImageState {
        let media = try await gateway.getMediaStatus(gardenId: gardenId, mediaId: planMediaId)
        guard let derivative = media.displayDerivative else {
            return media.processingState == .processing ? .loading : .unavailable
        }

        let access = try await gateway.getMediaAccess(gardenId: gardenId, mediaId: derivative.mediaId)
        let data = try await fetchData(access.url)

        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            return .unavailable
        }
        return .ready(
            PlanBackgroundImage(
                id: derivative.mediaId,
                image: image,
                pixelWidth: image.width,
                pixelHeight: image.height
            )
        )
    }
}
