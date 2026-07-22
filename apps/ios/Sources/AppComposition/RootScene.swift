import FeatureAuthentication
import FeatureGardens
import FeatureHealth
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
