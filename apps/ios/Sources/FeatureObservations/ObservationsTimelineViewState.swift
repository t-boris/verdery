/// One photo's stubbed analysis pass, surfaced plainly — never as a
/// confirmed diagnosis. `requiresConfirmation` is always `true` on the real
/// API; this row shows it anyway rather than assuming that invariant holds.
public struct ObservationAnalysisSummary: Equatable, Sendable, Identifiable {
    public let id: String
    public let kindLabel: String
    public let suggestedLabel: String
    public let confidenceText: String
    public let requiresConfirmation: Bool
    public let requestedAdditionalEvidence: Bool
}

/// One row of the observation timeline, already localized.
public struct ObservationRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let noteText: String?
    public let conditionSummary: String?
    public let observedAtText: String
    /// Whether a later observation names this one in its own
    /// `correctsObservationId` — this row's own content is never mutated to
    /// reflect a correction; the correction is a separate, later row.
    public let isCorrected: Bool
    /// Non-`nil` when this row is itself a correction of another.
    public let correctionKindLabel: String?
    /// The id of the observation this row corrects — non-`nil` exactly when
    /// `correctionKindLabel` is, carried separately because it is raw data
    /// (an id to display, not a translated label) rather than something
    /// `ObservationsLocalization` resolves.
    public let correctsObservationId: String?
    public let analysisSummaries: [ObservationAnalysisSummary]
}

/// Immutable display state for the observation timeline screen.
public enum ObservationsTimelineViewState: Equatable, Sendable {
    case loading
    case loaded([ObservationRow])
    case failed(message: String)
}
