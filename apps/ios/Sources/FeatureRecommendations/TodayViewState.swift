import CoreDomain

/// One evidence entry of a Today item, already localized.
public struct TodayEvidenceLine: Equatable, Sendable, Identifiable {
    public let id: String
    /// The evidence kind's localized display name.
    public let kindLabel: String
    /// The stored fact as readable text (`factKey: value`).
    public let factText: String
}

/// One Today item, already localized — the row shows the headline slice
/// (action, target, reason, urgency, category, window, score, uncertainty);
/// the detail screen additionally renders the full priority breakdown and
/// evidence list this same value carries.
public struct TodayItemPresentation: Equatable, Sendable, Identifiable {
    public let id: String
    /// FR-24's proposed action — the rule version's own action title.
    public let actionTitle: String
    /// What the recommendation targets: the plant's display name, the
    /// localized whole-garden label, or the garden-area fallback.
    public let targetLabel: String
    /// FR-24's "Reason": the deterministic explanation stored at generation
    /// time, shown verbatim.
    public let explanation: String
    public let urgencyLabel: String
    /// The rule's care category, shown as stored — an open vocabulary the
    /// server deliberately does not enumerate yet.
    public let careCategory: String
    /// The validity window as one readable line, `nil` when the candidate
    /// has no window.
    public let windowText: String?
    public let priorityScoreText: String
    /// The `confidence` factor rendered readable — FR-24's uncertainty,
    /// including any stale-weather label the engine stored in the factor's
    /// basis. `nil` only when the stored factors carry no confidence factor.
    public let uncertaintyText: String?
    /// `true` for the `elevated_risk` safety tier — the row and detail
    /// screen surface the caution label instead of hiding the tier.
    public let isElevatedRisk: Bool
    public let safetyTierLabel: String
    /// The full priority breakdown, one readable line per stored factor —
    /// the factors alone reproduce the rank, so this is the rank's own
    /// explanation, not a decoration.
    public let factorLines: [String]
    public let evidenceLines: [TodayEvidenceLine]
    /// Feeds the next command's `If-Match`.
    public let revision: Int
}

/// Immutable display state for the Today screen.
///
/// `.offline` is a distinct, named state rather than a generic failure: the
/// Today surface is online-only by documented decision (see
/// `TodayUseCases.swift`), so "needs a connection" is a truthful description
/// of the surface, not an error the user caused — the calibration flow's
/// established precedent. An EMPTY loaded list is a real state too (`.loaded`
/// with no items): no candidate needs attention, which the view renders as
/// an honest empty state, never an error.
public enum TodayViewState: Equatable, Sendable {
    case loading
    case loaded([TodayItemPresentation])
    /// The first load failed at the transport layer with nothing fetched
    /// this session to show honestly instead.
    case offline
    case failed(message: String)
}
