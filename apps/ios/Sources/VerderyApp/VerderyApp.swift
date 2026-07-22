import AppComposition
import FirebaseAppCheck
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
        // Must run before FirebaseApp.configure(): the SDK reads the
        // provider factory during configuration and silently ignores one set
        // afterward.
        //
        // Source: architecture/identity-and-authorization.md, section
        // "12. App Check".
        Self.configureAppCheckProviderFactory()

        // Must run before AppCompositionRoot constructs anything that touches
        // Firebase Auth. Only the Xcode-built app target (not this file's
        // other build, the headless `swift build`/`swift test` SPM
        // executable, which never runs this init) has a real
        // GoogleService-Info.plist bundled.
        FirebaseApp.configure()
    }

    /// The Simulator cannot perform App Attest, so DEBUG builds (local
    /// development, CI, the Simulator) fall back to the debug provider
    /// instead. Its token is classified as invalid by the backend unless the
    /// build's debug token is registered in the Firebase console — expected
    /// and harmless while App Check runs monitor-only, per rollout stage 1.
    ///
    /// Source: architecture/ios-application-design.md, section
    /// "17. Security and Privacy" ("App Check is integrated before
    /// enforcement is enabled server-side."); architecture/identity-and-
    /// authorization.md, section "12. App Check".
    private static func configureAppCheckProviderFactory() {
        #if DEBUG
        AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
        #else
        AppCheck.setAppCheckProviderFactory(AppAttestProviderFactory())
        #endif
    }

    @MainActor
    private static func makeComposition() -> AppCompositionRoot {
        AppCompositionRoot(configuration: AppEnvironment.development)
    }

    var body: some Scene {
        RootScene(composition: Self.makeComposition())
    }
}
