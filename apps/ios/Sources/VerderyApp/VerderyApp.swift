import AppComposition
import SwiftUI

/// Application entry point.
///
/// It does nothing except build the composition root and hand it to the root
/// scene, so that everything the application does stays testable in a module
/// rather than in an entry point no test can construct.
///
/// Source: architecture/ios-application-design.md, section "4. Application Structure".
@main
struct VerderyApp: App {
    @MainActor
    private static func makeComposition() -> AppCompositionRoot {
        AppCompositionRoot(configuration: AppEnvironment.development)
    }

    var body: some Scene {
        RootScene(composition: Self.makeComposition())
    }
}
