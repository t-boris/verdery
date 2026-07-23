/// Requests to navigate from this garden's settings screen to its plant
/// inventory, observation history, and manual tasks screens.
///
/// One marker type per destination, the same `GardenMapEditorRoute` pattern:
/// `FeatureGardens` cannot depend on `FeaturePlants`/`FeatureObservations`/
/// `FeatureTasks` — "features never depend on each other,"
/// `Tests/ArchitectureTests/DependencyRuleTests.swift` — so this feature only
/// says *that* each screen should open, never builds it itself.
/// `AppComposition/RootScene.swift`, which depends on every feature, is what
/// turns each value into its real view.
///
/// Source: implementation-plan.md work package P4-IOS-01.
public struct GardenPlantsRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}

public struct GardenObservationsRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}

public struct GardenTasksRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}

/// Requests to navigate from this garden's settings screen to its sync
/// conflicts screen — the same marker-type pattern as the three routes
/// above, `FeatureGardens` cannot depend on `FeatureSyncConflicts` either.
///
/// Source: implementation-plan.md work package P5-CONFLICT-01.
public struct GardenSyncConflictsRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}
