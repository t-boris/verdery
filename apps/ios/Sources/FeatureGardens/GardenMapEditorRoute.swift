/// A request to navigate from this garden's settings screen to its map
/// editor.
///
/// `FeatureGardens` cannot depend on `FeatureMap` — "features never depend
/// on each other," `Tests/ArchitectureTests/DependencyRuleTests.swift` — so
/// this feature cannot name `MapEditorView` or `MapEditorViewModel`
/// directly. It only needs to say *that* a garden's map should open, not
/// build the screen that shows it; `AppComposition/RootScene.swift`, which
/// depends on both features, is what turns this value into a
/// `MapEditorView`.
///
/// A distinct `Hashable` type rather than pushing the garden id as a bare
/// `String`: `GardensListView` already registers its own
/// `.navigationDestination(for: String.self)` for garden ids on the same
/// navigation stack this route is pushed onto, and SwiftUI's own guidance is
/// that more than one `navigationDestination` for the same data type on one
/// stack is ambiguous. A dedicated type sidesteps that instead of relying on
/// which declaration happens to sit closer to the stack root.
public struct GardenMapEditorRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}
