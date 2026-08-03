/// Keys the visual plant journal resolves against the localization catalogue
/// (P11-MEDIA-01): the shot-purpose vocabulary a photograph is labelled with
/// when it is attached, and the control that asks for it.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum ObservationJournalLocalizationKey: String, Sendable, CaseIterable {
    case observationsJournalTitle = "observations.journal.title"
    case observationsJournalPurposeFilterLabel = "observations.journal.purposeFilterLabel"
    case observationsJournalAllPurposes = "observations.journal.allPurposes"
    case observationsJournalEmpty = "observations.journal.empty"
    case observationsJournalEmptyForPurpose = "observations.journal.emptyForPurpose"
    case observationsJournalOpenButton = "observations.journal.openButton"
    case observationsPhotoPurposeLabel = "observations.photoPurpose.label"
    case observationsPhotoPurposeWholePlant = "observations.photoPurpose.wholePlant"
    case observationsPhotoPurposeLeafFront = "observations.photoPurpose.leafFront"
    case observationsPhotoPurposeLeafBack = "observations.photoPurpose.leafBack"
    case observationsPhotoPurposeStemOrBark = "observations.photoPurpose.stemOrBark"
    case observationsPhotoPurposeFlower = "observations.photoPurpose.flower"
    case observationsPhotoPurposeFruit = "observations.photoPurpose.fruit"
    case observationsPhotoPurposeSymptomCloseUp = "observations.photoPurpose.symptomCloseUp"
    case observationsPhotoPurposeContextOrFreeForm = "observations.photoPurpose.contextOrFreeForm"
}
