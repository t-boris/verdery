import CoreDomain
import CoreNetworking
import Foundation
import Observation

/// One resolved photo for the plant photo gallery: the domain `PlantPhoto`
/// row plus its currently-valid signed display URL.
public struct PlantPhotoDisplayItem: Identifiable, Sendable {
    public let photo: PlantPhoto
    public let url: URL

    public var id: String { photo.id }
}

/// Loads and holds a plant's photo gallery — the read-only counterpart to
/// `CoreMediaTransfer.PhotoAttachmentController`'s upload-side state.
///
/// `ListPlantPhotos` returns `PlantPhoto` rows (a stable `mediaId`, no
/// viewable URL on its own); `mediaGateway.getMediaAccess` resolves each
/// row's `mediaId` to a short-lived signed URL, the same two-step
/// resolution `FeatureMap.LoadPlanBackgroundImage` already uses for a plan's
/// background image. Depends on `MediaGateway` directly (a `CoreNetworking`
/// protocol, not the `CoreMediaTransfer` module) — the same legal bridge
/// `ListGardenMapObjects` already establishes for `MapGateway`.
///
/// A plant's photo count is always small (no pagination on this read —
/// `packages/api-contracts/openapi.yaml`'s own unpaginated
/// `PlantPhotoListResult`), so every photo's URL is resolved eagerly on
/// `load()` rather than per row on scroll.
@MainActor
@Observable
public final class PlantPhotoGalleryController {
    public private(set) var photos: [PlantPhotoDisplayItem] = []
    public private(set) var isLoading = false

    private let listPlantPhotos: ListPlantPhotos
    private let mediaGateway: any MediaGateway

    public init(listPlantPhotos: ListPlantPhotos, mediaGateway: any MediaGateway) {
        self.listPlantPhotos = listPlantPhotos
        self.mediaGateway = mediaGateway
    }

    /// Best-effort: a photo whose access URL fails to resolve is dropped
    /// from the gallery rather than failing the whole load — one broken
    /// signed-URL fetch should never hide every other photo. A `listPlantPhotos`
    /// failure clears the gallery to empty, the same honest "nothing to show"
    /// posture `PlantDetailViewModel.pendingIdentification` takes for its own
    /// best-effort fetch.
    public func load(gardenId: String, plantId: String) async {
        isLoading = true
        defer { isLoading = false }

        guard let rows = try? await listPlantPhotos(gardenId: gardenId, plantId: plantId) else {
            photos = []
            return
        }

        var resolved: [PlantPhotoDisplayItem] = []
        for photo in rows {
            guard let access = try? await mediaGateway.getMediaAccess(gardenId: gardenId, mediaId: photo.mediaId) else {
                continue
            }
            resolved.append(PlantPhotoDisplayItem(photo: photo, url: access.url))
        }
        photos = resolved
    }
}
