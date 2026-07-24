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
    #if os(iOS)
    // Required for real background-capable media upload (P6-IOS-01): only a
    // `UIApplicationDelegate` receives `application(_:
    // handleEventsForBackgroundURLSession:completionHandler:)`, the callback
    // the OS uses to wake this app — including from fully terminated — once
    // a background upload session it manages has events ready. SwiftUI's
    // `App` protocol itself has no equivalent hook. `#if os(iOS)`: UIKit
    // does not exist on the headless macOS target this package also builds
    // for (`Package.swift`'s own comment); this feature has no macOS
    // equivalent to wire up.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    // `@State`, not a computed property recreated on every `body`
    // evaluation: a fresh `AppCompositionRoot` per `body` call would
    // re-listen for Firebase auth state changes repeatedly
    // (`AuthenticationSessionObserver.init`) and, as of P6-IOS-01,
    // construct a second background `URLSession` sharing the SAME
    // `AppCompositionRoot.mediaBackgroundSessionIdentifier` — undefined
    // behavior per Apple's own documented one-session-per-identifier
    // contract. `State` guarantees this value is created exactly once and
    // survives every subsequent `body` evaluation for the lifetime of this
    // `App` instance.
    @State private var composition: AppCompositionRoot

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

        let root = AppCompositionRoot(configuration: AppEnvironment.development)
        _composition = State(wrappedValue: root)

        #if os(iOS)
        // Hands the composition root to the app delegate as early as
        // possible: `handleEventsForBackgroundURLSession` can fire
        // immediately once `application(_:didFinishLaunchingWithOptions:)`
        // returns, if the OS relaunched this process specifically to
        // deliver a finished background transfer — there is no later,
        // guaranteed-safe point to defer this handoff to. Setting a
        // property on an `@UIApplicationDelegateAdaptor`-wrapped object from
        // within `App.init()` is the standard, documented pattern for this
        // exact handoff (the adaptor's wrapped delegate instance already
        // exists by the time this initializer body runs).
        appDelegate.composition = root
        #endif
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

    var body: some Scene {
        RootScene(composition: composition)
    }
}
