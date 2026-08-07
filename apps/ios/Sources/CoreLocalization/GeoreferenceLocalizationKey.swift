/// Placing a garden on the Earth.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum GeoreferenceLocalizationKey: String, Sendable, CaseIterable {
    case georeferenceTitle = "georeference.title"
    case georeferenceOpen = "georeference.open"
    case georeferenceExplanation = "georeference.explanation"
    case georeferenceNotSet = "georeference.notSet"

    case georeferenceUseMyLocation = "georeference.useMyLocation"
    case georeferenceLocating = "georeference.locating"
    case georeferenceLocationDenied = "georeference.locationDenied"
    case georeferenceSearchAddress = "georeference.searchAddress"
    case georeferenceSearchHint = "georeference.searchHint"
    case georeferenceNoCandidates = "georeference.noCandidates"
    case georeferenceProviderUnavailable = "georeference.providerUnavailable"
    case georeferenceDropPin = "georeference.dropPin"
    case georeferenceDropPinHint = "georeference.dropPinHint"
    case georeferenceUseThisPoint = "georeference.useThisPoint"

    case georeferencePrecisionStreetAddress = "georeference.precision.streetAddress"
    case georeferencePrecisionStreet = "georeference.precision.street"
    case georeferencePrecisionArea = "georeference.precision.area"

    case georeferenceNorth = "georeference.north"
    case georeferenceNorthHint = "georeference.northHint"
    case georeferenceNorthValue = "georeference.northValue"
    case georeferenceUseDeviceHeading = "georeference.useDeviceHeading"
    case georeferenceHeadingProposed = "georeference.headingProposed"

    case georeferenceAnchor = "georeference.anchor"
    case georeferenceAnchorValue = "georeference.anchorValue"
    case georeferenceAccuracy = "georeference.accuracy"
    case georeferenceAccuracyValue = "georeference.accuracyValue"
    case georeferenceAccuracyUnknown = "georeference.accuracyUnknown"

    case georeferenceSave = "georeference.save"
    case georeferenceSaved = "georeference.saved"
    case georeferenceConflict = "georeference.conflict"
    case georeferenceFailed = "georeference.failed"
    case georeferenceOffline = "georeference.offline"
    case georeferenceReplaceWarning = "georeference.replaceWarning"
}
