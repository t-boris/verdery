import CoreDomain

/// Immutable display state for a single plant's detail screen.
public enum PlantDetailViewState: Equatable, Sendable {
    case loading
    case loaded(PlantDetailSummary)
    case failed(message: String)
}

/// Read-only, already-localized fields for the detail screen's summary
/// section. The edit form below it works from the view model's own editable
/// fields, not this summary, the same split `GardenSettingsViewModel` makes
/// between `GardenSettingsSummary` and `editedName`.
public struct PlantDetailSummary: Equatable, Sendable {
    public let displayName: String
    public let groupingKindLabel: String
    public let quantity: Int?
    public let lifecycleStage: PlantLifecycleStage
    public let lifecycleStageLabel: String
    public let status: PlantStatus
    public let statusLabel: String
    public let taxonomyReferenceId: String?
    public let revision: Int
}
