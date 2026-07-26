import CoreDomain

/// One row of the garden list, already localized — the view renders this and
/// nothing else.
///
/// `lifecycleState` and `callerRole` travel alongside their localized labels
/// so the card can pick a symbol and a tone for each. Deliberately the raw
/// domain value rather than a symbol name chosen here: which SF Symbol stands
/// for "archived" is a presentation decision, and presentation decisions
/// belong in the view, not in a projection the view model builds.
public struct GardenSummary: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let lifecycleState: GardenLifecycleState
    public let callerRole: GardenRole
    public let lifecycleLabel: String
    public let roleLabel: String
    /// Set to a localized "Saved locally" label when this garden reflects a
    /// local-only mutation from the current session that this pilot stage
    /// cannot yet confirm has synchronized — `nil` otherwise. See
    /// `GardensListViewModel.summary(for:)`'s doc comment for the scoping
    /// rationale.
    public let syncStatusLabel: String?
}

/// Immutable display state for the garden list screen.
public enum GardensListViewState: Equatable, Sendable {
    case loading
    case loaded([GardenSummary])
    case failed(message: String)
}
