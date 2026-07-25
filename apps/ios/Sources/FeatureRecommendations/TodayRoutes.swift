/// Request to navigate from the Today screen to the same garden's task list
/// — the destination a successful conversion links to, since the converted
/// task appearing in that list is this phase's outcome-history linkage.
///
/// A marker type on the `GardenMapEditorRoute`/`GardenTasksRoute` pattern:
/// `FeatureRecommendations` cannot depend on `FeatureTasks` ("features never
/// depend on each other," `Tests/ArchitectureTests/DependencyRuleTests.swift`),
/// so this feature only says *that* the task list should open;
/// `AppComposition/RootScene.swift` turns the value into the real view.
///
/// Source: implementation-plan.md work package P7-IOS-01.
public struct TodayTasksRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}

/// Pushes one Today item's detail screen. Unlike the cross-feature routes
/// above, both ends live in this feature — the marker type exists so the
/// list and detail share one `TodayViewModel` through the enclosing
/// `TodayView`'s own `navigationDestination`, rather than the composition
/// root having to construct a second model for the same screenful of state.
public struct TodayItemDetailRoute: Hashable, Sendable {
    public let itemId: String

    public init(itemId: String) {
        self.itemId = itemId
    }
}
