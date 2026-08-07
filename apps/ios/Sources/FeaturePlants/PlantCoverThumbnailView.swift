import CoreDesignSystem
import CoreDomain
import CoreNetworking
import SwiftUI

/// A plant list row's cover-photo thumbnail: resolves `Plant.coverMediaId`
/// (only ever set by `SearchPlants` — see that field's own doc comment) to a
/// signed URL lazily, as the row appears, the same `MediaGateway.getMediaAccess`
/// two-step resolution `PlantPhotoGalleryController` uses for the full
/// gallery — but per-row and on-appear here, since a search page can hold up
/// to 50 rows and eagerly resolving every one's URL up front (as the gallery
/// does for a single plant's always-small photo count) would mean up to 50
/// signed-URL round trips before the list finishes loading.
///
/// Falls back to a lifecycle-stage icon (`PlantSymbols.lifecycleStage`, the
/// same set the detail page already uses) whenever there is no cover photo,
/// no gateway (a call site not wired for photo resolution), or the
/// resolution fails — including the documented dev-environment gap where
/// unprocessed media 409s (`docs/development/deferred-capabilities.md`).
struct PlantCoverThumbnailView: View {
    let gardenId: String
    let mediaId: String?
    let displayName: String
    let lifecycleStage: PlantLifecycleStage
    let mediaGateway: (any MediaGateway)?

    @State private var url: URL?

    /// Larger than `IconMedallion`'s own touch-target size: a real photo
    /// reads as decoration at 44pt, but a plant's list row is meant to be
    /// photo-forward, not icon-forward — see this feature's own standing
    /// "UI should be built around this concept" direction.
    @ScaledMetric(relativeTo: .body) private var thumbnailSize: CGFloat = 64

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    fallback
                }
            } else {
                fallback
            }
        }
        .frame(width: thumbnailSize, height: thumbnailSize)
        .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous))
        .task(id: mediaId) {
            url = nil
            guard let mediaId, let mediaGateway else { return }
            url = try? await mediaGateway.getMediaAccess(gardenId: gardenId, mediaId: mediaId).url
        }
    }

    private var fallback: some View {
        RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
            .fill(PlantSymbols.lifecycleTone(lifecycleStage).quietFill)
            .overlay(
                Image(systemName: PlantSymbols.lifecycleStage(lifecycleStage))
                    .font(Typography.title)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(PlantSymbols.lifecycleTone(lifecycleStage).foreground)
            )
            .accessibilityLabel(displayName)
    }
}
