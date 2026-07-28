import CoreDesignSystem
import SwiftUI

/// A plant's attached photos, as a horizontally scrolling row of thumbnails —
/// the read side of `photoSection`'s existing "attach a new photo"
/// affordance in `PlantDetailView`. Absent entirely while empty: an empty
/// gallery is not an error state, just nothing to show yet.
///
/// Tapping a thumbnail opens it full-size in a sheet — the simplest "see the
/// whole photo" affordance this pass needs; a swipeable full-screen viewer is
/// left for a later pass if a garden's photo count ever makes one worthwhile.
public struct PlantPhotoGalleryView: View {
    private let photos: [PlantPhotoDisplayItem]
    private let title: String
    @State private var selectedPhoto: PlantPhotoDisplayItem?

    /// The thumbnail's fixed square size, scaled with the reader's text size
    /// — the same `@ScaledMetric` convention every other literal dimension in
    /// this codebase follows (`AccessibilityConventionTests`'s own "no fixed
    /// frame dimension escapes @ScaledMetric" rule).
    @ScaledMetric(relativeTo: .body) private var thumbnailSize: CGFloat = 96

    public init(photos: [PlantPhotoDisplayItem], title: String) {
        self.photos = photos
        self.title = title
    }

    public var body: some View {
        if !photos.isEmpty {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: PlantSymbols.photo, title: title)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Metrics.space2) {
                        ForEach(photos) { photo in
                            Button {
                                selectedPhoto = photo
                            } label: {
                                thumbnail(photo)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("plants.detail.gallery.photo")
                        }
                    }
                    .padding(.vertical, Metrics.space1)
                }
                .accessibilityIdentifier("plants.detail.gallery")
            }
            .sheet(item: $selectedPhoto) { photo in
                AsyncImage(url: photo.url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    ProgressView()
                }
                .padding(Metrics.space4)
            }
        }
    }

    private func thumbnail(_ photo: PlantPhotoDisplayItem) -> some View {
        AsyncImage(url: photo.url) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous)
                .fill(Palette.surfaceSunken)
                .overlay(ProgressView())
        }
        .frame(width: thumbnailSize, height: thumbnailSize)
        .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusMedium, style: .continuous))
    }
}
