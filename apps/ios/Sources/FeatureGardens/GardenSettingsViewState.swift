import CoreDomain

/// Immutable display state for a single garden's settings screen.
public enum GardenSettingsViewState: Equatable, Sendable {
    case loading
    case loaded(GardenSettingsSummary)
    case failed(message: String)
}

public struct GardenSettingsSummary: Equatable, Sendable {
    public let name: String
    /// Carried alongside the localized labels so the screen can pick a symbol
    /// and a tone for each — see `GardenSummary`'s identical reasoning.
    public let lifecycleState: GardenLifecycleState
    public let callerRole: GardenRole
    public let lifecycleLabel: String
    public let roleLabel: String
    /// Owner-only commands are hidden, not merely disabled, when this is `false`.
    public let isOwner: Bool
    public let isActive: Bool
    public let revision: Int
    /// Set to a localized "Saved locally" label when this session's most
    /// recent mutation on this garden hasn't been confirmed synchronized yet
    /// — `nil` otherwise. See `GardensListViewModel.summary(for:)`'s doc
    /// comment for the same, deliberately session-scoped, decision.
    public let syncStatusLabel: String?
}
