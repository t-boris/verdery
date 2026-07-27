/// Requests to navigate from the Seasonal plan screen's hemisphere-unknown
/// empty state to the garden's map/georeference calibration flow.
///
/// A marker type on the `TodayTasksRoute`/`GardenMapEditorRoute` pattern:
/// `FeatureSeasonalPlan` cannot depend on `FeatureMap` ("features never
/// depend on each other," `Tests/ArchitectureTests/DependencyRuleTests.swift`),
/// so this feature only says *that* the map editor should open;
/// `AppComposition/GardenTabView.swift` turns the value into the real view —
/// the same `MapEditorView` the Map tab and `GardenMapEditorRoute` already
/// reach, just resolved from this screen's own stack instead.
///
/// Source: implementation-plan.md work package P9D-UX-01.
public struct SeasonalPlanCalibrationRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}
