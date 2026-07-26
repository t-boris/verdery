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

/// Requests to navigate to this garden's property-plan upload screen
/// (P6-PLAN iOS parity). Unlike the routes above, the destination lives in
/// this same feature (`GardenPlanUploadView`) — the marker type exists
/// anyway because the view's dependencies (the shared upload coordinator)
/// can only be assembled by the composition root, the same reason
/// `GardenMapEditorRoute` routes through it.
public struct GardenPlanUploadRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}

/// Requests to navigate from this garden's settings screen to its Today
/// recommendation screen (P7-IOS-01) — the same marker-type pattern as
/// every route above; `FeatureGardens` cannot depend on
/// `FeatureRecommendations` either.
public struct GardenTodayRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}

/// Requests to navigate from the garden settings sheet to the service-status
/// screen (P8-UX-01).
///
/// `FeatureHealth` is a sibling feature, so the same marker-type pattern
/// applies. The route carries no garden id — service health is a property of
/// the deployment, not of a garden — but is still a distinct `Hashable` type,
/// because a `navigationDestination` is registered per type and an empty
/// struct is the smallest thing that can identify this one.
public struct GardenServiceHealthRoute: Hashable, Sendable {
    public init() {}
}

/// Requests to navigate from this garden's settings screen to its
/// Collaborators screen (P9A-IOS-01) — the same marker-type pattern as
/// `GardenPlanUploadRoute`: the destination (`CollaboratorsView`) lives in
/// this same feature, but its view model needs a `CollaborationGateway` only
/// the composition root can construct, so a route value, not a direct
/// `NavigationLink` to the view, is what `GardenSettingsView` pushes.
///
/// `isOwner` travels with the route rather than being re-derived by the
/// destination screen: `GardenSettingsView` already knows the caller's role
/// from the `Garden` it loaded to render this same settings screen, and
/// hiding owner-only sections is a usability choice the server independently
/// enforces regardless (`CollaboratorsViewModel`'s own doc comment).
public struct GardenCollaboratorsRoute: Hashable, Sendable {
    public let gardenId: String
    public let isOwner: Bool

    public init(gardenId: String, isOwner: Bool) {
        self.gardenId = gardenId
        self.isOwner = isOwner
    }
}
