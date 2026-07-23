import FeatureAuthentication
import FeatureGardens
import FeatureHealth
import FeatureMap
import FeatureObservations
import FeaturePlants
import FeatureSyncConflicts
import FeatureTasks
import SwiftUI

/// The application's root scene.
///
/// It resolves a route to a feature view through the composition root, which is
/// the only direction the dependency rule permits: composition knows every
/// feature, and no feature knows composition.
///
/// Source: architecture/ios-application-design.md, section "21. Dependency Rules".
public struct RootScene: Scene {
    private let composition: AppCompositionRoot

    public init(composition: AppCompositionRoot) {
        self.composition = composition
    }

    public var body: some Scene {
        WindowGroup {
            RootView(composition: composition)
        }
    }
}

/// Root view hierarchy.
///
/// Routes between the sign-in screen and the authenticated application based
/// on `AuthenticationSessionObserver`, kept current by Firebase's own
/// listener rather than a one-time snapshot — see that type for why.
///
/// iPhone and iPad share this hierarchy; a size-class-driven split arrives with
/// the first feature that has a list and a detail.
public struct RootView: View {
    private let composition: AppCompositionRoot

    @State private var path: [AppRoute] = [.gardens]
    /// App foreground/background transitions — architecture/ios-application-
    /// design.md, section "8. Synchronization Integration": the
    /// synchronization engine "reacts to: ... App foreground/background
    /// transitions." (P5-IOS-03, Stage 5b.)
    ///
    /// The only real scene-phase/foreground trigger this codebase wires:
    /// connectivity-change (`NWPathMonitor`) and background-processing-
    /// opportunity (`BGTaskScheduler`) triggers remain a real, separate gap
    /// — confirmed by inspection, not assumed, that nothing in this
    /// codebase observes either today (no `NWPathMonitor`/`BGTaskScheduler`/
    /// `scenePhase` reference existed anywhere before this change). Both
    /// would need genuinely new subsystems (a path monitor actor;
    /// `BGTaskSchedulerPermittedIdentifiers` in `Info.plist` plus a
    /// registered background task handler) well beyond "a small, clearly-
    /// scoped addition," so they are left as a documented gap for a future
    /// stage rather than built here.
    @Environment(\.scenePhase) private var scenePhase

    public init(composition: AppCompositionRoot) {
        self.composition = composition
    }

    public var body: some View {
        if composition.sessionObserver.isSignedIn {
            NavigationStack(path: $path) {
                destination(for: path.first ?? .gardens)
                    .navigationDestination(for: AppRoute.self, destination: destination(for:))
                    // A distinct type from both `AppRoute` and the bare
                    // `String` `GardensListView` pushes for a garden id — see
                    // `GardenMapEditorRoute`'s doc comment for why reusing
                    // either would be ambiguous on this one stack.
                    .navigationDestination(for: GardenMapEditorRoute.self) { route in
                        MapEditorView(model: composition.makeMapEditorViewModel(gardenId: route.gardenId))
                    }
                    // Phase 4: plant inventory, observation history, and
                    // manual tasks — one route type per destination, the
                    // same reason `GardenMapEditorRoute` exists.
                    .navigationDestination(for: GardenPlantsRoute.self) { route in
                        PlantsHomeView(model: composition.makePlantsHomeViewModel(gardenId: route.gardenId)) { plantId in
                            AnyView(
                                PlantDetailView(
                                    model: composition.makePlantDetailViewModel(gardenId: route.gardenId, plantId: plantId)
                                )
                            )
                        }
                    }
                    .navigationDestination(for: GardenObservationsRoute.self) { route in
                        ObservationsTimelineView(
                            model: composition.makeObservationsTimelineViewModel(gardenId: route.gardenId)
                        )
                    }
                    .navigationDestination(for: GardenTasksRoute.self) { route in
                        TasksListView(model: composition.makeTasksListViewModel(gardenId: route.gardenId))
                    }
                    // P5-CONFLICT-01: the durable conflict list/compare/
                    // resolve screen, one route type per destination, the
                    // same reason `GardenTasksRoute`/`GardenPlantsRoute`/
                    // `GardenObservationsRoute` exist.
                    .navigationDestination(for: GardenSyncConflictsRoute.self) { route in
                        SyncConflictsView(model: composition.makeSyncConflictsViewModel(gardenId: route.gardenId))
                    }
            }
            .onChange(of: scenePhase) { _, newPhase in
                guard newPhase == .active else { return }
                Self.triggerSyncOnForeground(composition: composition)
            }
        } else {
            NavigationStack {
                SignInView(model: composition.makeSignInViewModel())
            }
        }
    }

    @ViewBuilder
    private func destination(for route: AppRoute) -> some View {
        switch route {
        case .gardens:
            GardensListView(model: composition.makeGardensListViewModel()) { gardenId in
                AnyView(GardenSettingsView(model: composition.makeGardenSettingsViewModel(gardenId: gardenId)))
            }
        case .serviceHealth:
            ServiceHealthView(model: composition.makeServiceHealthViewModel())
        }
    }

    /// A fresh engine per foreground transition, matching `makeSyncEngine()`'s
    /// own "opened fresh per call" reasoning — a scene-phase transition is
    /// infrequent enough (once per foregrounding, not a tight loop) that
    /// constructing one is cheap relative to it, and it always reflects
    /// whichever profile is currently signed in. Fire-and-forget: this
    /// trigger has no UI to report failure to yet (`SyncEngineStatus` wiring
    /// is a deliberately separate follow-up — see `RemoteSyncEngine.status`'s
    /// own doc comment), so a failure here is silently absorbed the same way
    /// `retryNow()`'s own doc comment already accepts for the retry trigger:
    /// the next successful trigger — another foregrounding, or the follow-up
    /// UI's own explicit retry once built — resolves it.
    @MainActor
    private static func triggerSyncOnForeground(composition: AppCompositionRoot) {
        let engine = composition.makeSyncEngine()
        Task {
            try? await engine.retryNow()
        }
    }
}
