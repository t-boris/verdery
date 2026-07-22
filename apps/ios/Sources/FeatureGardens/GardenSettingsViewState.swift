/// Immutable display state for a single garden's settings screen.
public enum GardenSettingsViewState: Equatable, Sendable {
    case loading
    case loaded(GardenSettingsSummary)
    case failed(message: String)
}

public struct GardenSettingsSummary: Equatable, Sendable {
    public let name: String
    public let lifecycleLabel: String
    public let roleLabel: String
    /// Owner-only commands are hidden, not merely disabled, when this is `false`.
    public let isOwner: Bool
    public let isActive: Bool
    public let revision: Int
}
