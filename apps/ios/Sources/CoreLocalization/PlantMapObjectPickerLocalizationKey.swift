/// Keys the `gardenAreaMapObjectId`/`placementMapObjectId` picker sheet
/// resolves against the localization catalogue — shown from both the
/// "Add a plant" form and the plant detail screen's move section.
///
/// A second enum for `FeaturePlants` rather than more cases in
/// ``LocalizationKey`` — the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum PlantMapObjectPickerLocalizationKey: String, Sendable, CaseIterable {
    case plantsMapObjectPickerTitle = "plants.mapObjectPicker.title"
    case plantsMapObjectPickerClear = "plants.mapObjectPicker.clear"
    case plantsMapObjectPickerEmpty = "plants.mapObjectPicker.empty"
}
