/// Keys the "Add plant from photo" screen and the plant-detail pending-
/// identification banner resolve against the localization catalogue
/// (ADR-0015's client wiring).
///
/// A second enum for `FeaturePlants` rather than more cases in
/// ``LocalizationKey`` — the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum PlantIdentificationLocalizationKey: String, Sendable, CaseIterable {
    case plantsAddFromPhotoButton = "plants.addFromPhoto.button"
    case plantsAddFromPhotoTitle = "plants.addFromPhoto.title"
    case plantsAddFromPhotoHint = "plants.addFromPhoto.hint"
    case plantsAddFromPhotoSubmitting = "plants.addFromPhoto.submitting"

    case plantsIdentificationSuggestedLabel = "plants.identification.suggestedLabel"
    case plantsIdentificationNoConfidentMatch = "plants.identification.noConfidentMatch"
    case plantsIdentificationConfidenceLabel = "plants.identification.confidenceLabel"
    case plantsIdentificationConfirmButton = "plants.identification.confirmButton"
    case plantsIdentificationLaterButton = "plants.identification.laterButton"
    case plantsIdentificationConfirmedMessage = "plants.identification.confirmedMessage"

    case plantsIdentificationPendingBanner = "plants.identification.pendingBanner"
    case plantsIdentificationUnlistedNote = "plants.identification.unlistedNote"

    case plantsIdentificationVarietyLabel = "plants.identification.varietyLabel"
    case plantsIdentificationGrowthStageLabel = "plants.identification.growthStageLabel"
    case plantsIdentificationConditionLabel = "plants.identification.conditionLabel"
    case plantsIdentificationCareGuidanceLabel = "plants.identification.careGuidanceLabel"
    case plantsIdentificationAcquisitionDateLabel = "plants.identification.acquisitionDateLabel"

    /// `RecordObservationFromIdentification` (ADR-0015's own "AddPlantFromPhoto
    /// suggests an observation too" extension) — independent of, and shown
    /// alongside, the species-confirmation button above.
    case plantsIdentificationRecordObservationButton = "plants.identification.recordObservationButton"
    case plantsIdentificationObservationRecordedMessage = "plants.identification.observationRecordedMessage"
}
