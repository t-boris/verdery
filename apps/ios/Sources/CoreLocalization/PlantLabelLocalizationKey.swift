/// The plant-label sheet: a QR code to print, stake beside a plant, and later
/// point a camera at.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum PlantLabelLocalizationKey: String, Sendable, CaseIterable {
    case plantLabelTitle = "plantLabel.title"
    case plantLabelExplanation = "plantLabel.explanation"
    case plantLabelShare = "plantLabel.share"
    case plantLabelUnavailable = "plantLabel.unavailable"
    case plantLabelCodeAlt = "plantLabel.codeAlt"
}
