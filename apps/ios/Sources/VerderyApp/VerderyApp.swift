import AppComposition
import FirebaseCore
import SwiftUI

/// Application entry point.
///
/// It does nothing except configure Firebase, build the composition root, and
/// hand it to the root scene, so that everything the application does stays
/// testable in a module rather than in an entry point no test can construct.
///
/// Source: architecture/ios-application-design.md, section "4. Application Structure".
@main
struct VerderyApp: App {
    init() {
        // Must run before AppCompositionRoot constructs anything that touches
        // Firebase Auth. Only the Xcode-built app target (not this file's
        // other build, the headless `swift build`/`swift test` SPM
        // executable, which never runs this init) has a real
        // GoogleService-Info.plist bundled.
        FirebaseApp.configure()
    }

    @MainActor
    private static func makeComposition() -> AppCompositionRoot {
        AppCompositionRoot(configuration: AppEnvironment.development)
    }

    var body: some Scene {
        RootScene(composition: Self.makeComposition())
    }
}
