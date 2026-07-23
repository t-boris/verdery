import FeatureAuthentication
import FeatureGardens
import FeatureHealth
import FeatureMap
import FeatureObservations
import FeaturePlants
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
}
