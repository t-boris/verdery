import CoreDesignSystem
import CoreDomain

/// One photo's health-suggestion analysis pass (P11-HEALTH-01), surfaced
/// plainly — never as a confirmed diagnosis. `requiresConfirmation` is
/// always `true` on the real API; this row shows it anyway rather than
/// assuming that invariant holds.
///
/// `modelUnavailable` (`ImageAnalysisResult.modelName == nil`) means no
/// provider was ever reached — `suggestedLabel`/`confidenceText` are a fixed
/// placeholder in that case, so the view renders an honest "no model
/// reached" notice instead of a suggestion line that would otherwise read
/// as a real, if low-confidence, analysis. `evidenceSummary` empty and
/// `alternativeExplanations` empty both mean "nothing to show," not
/// "unknown" — a genuine analysis with nothing notable visible.
/// `dispositionSetAtText` is `nil` exactly when `disposition == .unresolved`.
public struct ObservationAnalysisSummary: Equatable, Sendable, Identifiable {
    public let id: String
    public let kindLabel: String
    public let suggestedLabel: String
    public let confidenceText: String
    public let requiresConfirmation: Bool
    public let requestedAdditionalEvidence: Bool
    public let modelUnavailable: Bool
    public let evidenceSummary: String
    public let alternativeExplanations: [String]
    public let safetyClassLabel: String
    public let safetyClassTone: Tone
    public let disposition: HealthSuggestionDisposition
    public let dispositionSetAtText: String?
}

/// One row of the observation timeline, already localized.
public struct ObservationRow: Equatable, Sendable, Identifiable {
    public let id: String
    /// The plant this observation is about, when it is about one — carried
    /// through (not shown directly) so `ObservationsTimelineViewModel
    /// .submitCorrection` can propagate it onto a correction's own local
    /// projection: `CorrectObservation` has no "current" local record of
    /// its own to read this back from (see `LocalObservationStore`'s own
    /// doc comment), so the row already on screen is where it comes from
    /// instead.
    public let plantId: String?
    /// The bed/area this observation is about, when it is about one — same
    /// reasoning and same non-display purpose as `plantId`.
    public let gardenObjectId: String?
    public let noteText: String?
    public let conditionSummary: String?
    public let observedAtText: String
    /// Whether a later observation names this one in its own
    /// `correctsObservationId` — this row's own content is never mutated to
    /// reflect a correction; the correction is a separate, later row.
    public let isCorrected: Bool
    /// True for a row this device recorded or corrected purely offline this
    /// session and has not yet confirmed synced — the append-only
    /// counterpart to `FeatureGardens.GardenSummary.syncStatusLabel`/
    /// `FeaturePlants.PlantDetailSummary.syncStatusLabel`. Unlike those,
    /// every row with this `true` came straight from
    /// `LocalObservationStore`, never from a stale network response that
    /// might need protecting against — nothing "in place" exists for an
    /// append-only record to protect (see `ObservationsTimelineViewModel
    /// .load()`'s own doc comment).
    public let isPendingSync: Bool
    /// Non-`nil` when this row is itself a correction of another.
    public let correctionKindLabel: String?
    /// The id of the observation this row corrects — non-`nil` exactly when
    /// `correctionKindLabel` is, carried separately because it is raw data
    /// (an id to display, not a translated label) rather than something
    /// `ObservationsLocalization` resolves.
    public let correctsObservationId: String?
    /// The symptoms the observer reported, already localized ("Wilting —
    /// Severe"). Deliberately a separate field from `analysisSummaries`, and
    /// rendered apart from it: one is what a person said they saw, the other
    /// what a model proposed, and a single list would read them as equals.
    public let symptomLabels: [String]
    public let analysisSummaries: [ObservationAnalysisSummary]
}

/// Immutable display state for the observation timeline screen.
public enum ObservationsTimelineViewState: Equatable, Sendable {
    case loading
    case loaded([ObservationRow])
    case failed(message: String)
}
