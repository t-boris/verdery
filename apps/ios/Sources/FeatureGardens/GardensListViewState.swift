/// One row of the garden list, already localized — the view renders this and
/// nothing else.
public struct GardenSummary: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let lifecycleLabel: String
    public let roleLabel: String
}

/// Immutable display state for the garden list screen.
public enum GardensListViewState: Equatable, Sendable {
    case loading
    case loaded([GardenSummary])
    case failed(message: String)
}
