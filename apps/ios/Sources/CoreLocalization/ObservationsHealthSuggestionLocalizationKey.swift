/// Keys the observation timeline's health-suggestion review (P11-HEALTH-01)
/// resolves against the localization catalogue: evidence/alternatives
/// display, the safety-class and disposition enum names, and the
/// disposition control itself.
///
/// A second enum for `FeatureObservations` rather than more cases in
/// ``LocalizationKey`` — the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line
/// ceiling.
public enum ObservationsHealthSuggestionLocalizationKey: String, Sendable, CaseIterable {
    case observationsAnalysisEvidenceSummary = "observations.analysis.evidenceSummary"
    case observationsAnalysisAlternativeExplanationsLabel = "observations.analysis.alternativeExplanationsLabel"
    case observationsAnalysisModelUnavailable = "observations.analysis.modelUnavailable"
    case observationsAnalysisDispositionLabel = "observations.analysis.dispositionLabel"
    case observationsAnalysisSaveDisposition = "observations.analysis.saveDisposition"
    case observationsAnalysisDispositionSaved = "observations.analysis.dispositionSaved"
    case observationsAnalysisDispositionSetBy = "observations.analysis.dispositionSetBy"
    case observationsSafetyClassInformational = "observations.safetyClass.informational"
    case observationsSafetyClassMonitor = "observations.safetyClass.monitor"
    case observationsSafetyClassExpertReviewRecommended = "observations.safetyClass.expertReviewRecommended"
    case observationsDispositionUnresolved = "observations.disposition.unresolved"
    case observationsDispositionConfirmedExternally = "observations.disposition.confirmedExternally"
    case observationsDispositionAcceptedAsObservation = "observations.disposition.acceptedAsObservation"
    case observationsDispositionRejected = "observations.disposition.rejected"
}
