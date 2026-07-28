/// Keys the plant detail screen's photo gallery resolves against the
/// localization catalogue.
///
/// A second enum for `FeaturePlants` rather than more cases in
/// ``LocalizationKey`` — the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum PlantPhotoGalleryLocalizationKey: String, Sendable, CaseIterable {
    case plantsPhotoGalleryTitle = "plants.photoGallery.title"
}
