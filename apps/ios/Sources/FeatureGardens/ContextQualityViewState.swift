import CoreDomain

/// One `GardenContextKind` row, already localized. Rendered for every kind
/// in `ContextQualityLocalization.orderedKinds` regardless of whether a
/// fact has been recorded yet — `fact == nil` renders as "Not yet
/// declared," never omitted from the list (FR-22's own "each context type"
/// wording).
public struct ContextQualityRow: Equatable, Sendable, Identifiable {
    public let id: GardenContextKind
    public let kindLabel: String
    /// `nil` when this garden has never recorded a fact for this kind.
    public let fact: GardenContextFact?
    /// The fixed-vocabulary option's label when recognized, the raw
    /// `fact.value` otherwise — `nil` exactly when `fact` is `nil`.
    public let valueDisplayText: String?
    /// `nil` exactly when `fact` is `nil`.
    public let sourceLabel: String?
    /// Set only when `fact.source == .horticulturallyReviewedDefault` AND
    /// both `reviewedBy`/`reviewedOn` are present — the "declared vs.
    /// operator default, at a glance" signal FR-22 asks for.
    public let reviewedDisplayText: String?
    /// `contextQuality.recordedByDisplay` — the raw `recordedByProfileId`,
    /// this codebase's own established fallback (no member display-name
    /// field exists anywhere). `nil` exactly when `fact` is `nil`.
    public let recordedByDisplayText: String?
}

/// The Context quality screen's loaded content, already localized.
public struct ContextQualityPresentation: Equatable, Sendable {
    public let rows: [ContextQualityRow]
    /// `true` for an owner or editor — matrix row B14's own eligibility
    /// rule, the identical two-role check `TasksListViewModel
    /// .eligibleAssignCandidates` already applies for the identical
    /// capability (`editGardenContent`). Gates whether the view even shows
    /// an edit affordance; the server independently enforces the same
    /// restriction regardless, so this is a usability choice, not the
    /// security boundary — the same posture `GardenSettingsSummary.isOwner`
    /// documents for its own owner-only commands.
    public let canEdit: Bool
}

/// Immutable display state for the Context quality screen.
///
/// The same `.loading`/`.loaded`/`.offline`/`.failed` shape `TodayViewState`
/// establishes, per this package's own "do not invent a new one"
/// instruction. `.offline` is distinct from `.failed`: this screen's reads
/// are online-only by documented decision (`ContextQualityUseCases.swift`),
/// so "needs a connection" is a truthful description of the surface.
public enum ContextQualityViewState: Equatable, Sendable {
    case loading
    case loaded(ContextQualityPresentation)
    case offline
    case failed(message: String)
}
