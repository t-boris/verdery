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
    /// The raw enum behind `groupingKindLabel`, exposed alongside the
    /// already-localized label so the view can gate the edit form's
    /// quantity field the same way `PlantsHomeView`'s add form already
    /// gates it — without duplicating a second, string-keyed switch just to
    /// re-derive what this value already is.
    public let groupingKind: PlantGroupingKind
    public let quantity: Int?
    public let lifecycleStage: PlantLifecycleStage
    public let lifecycleStageLabel: String
    public let status: PlantStatus
    public let statusLabel: String
    public let taxonomyReferenceId: String?
    public let revision: Int
}
