import CoreDesignSystem
import FeatureAuthentication
import FeatureGardens
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
                // The single hook that completes a federated or email-link
                // sign-in; see `AppCompositionRoot.handleIncomingURL`.
                //
                // `.onOpenURL` rather than `AppDelegate`'s
                // `application(_:open:options:)`: UIKit delivers that method
                // only to apps that do not adopt scenes, and a SwiftUI `App`
                // always does — the `@UIApplicationDelegateAdaptor` this app
                // installs for background uploads does not change that. This
                // modifier receives both custom-scheme URLs and universal
                // links, which is every shape a sign-in callback arrives in,
                // and it is attached above `RootView`'s own signed-in/
                // signed-out branch so a callback still lands if Firebase's
                // state listener flips the branch first.
                .onOpenURL { url in
                    composition.handleIncomingURL(url)
                }
        }
    }
}

/// Root view hierarchy.
///
/// Three states, in order of how far the reader has got: signed out, signed in
/// with no garden chosen, and inside one garden.
///
/// The third replaced a single `NavigationStack` rooted at the garden list, in
/// which every screen the app has was reached by pushing through
/// `GardenSettingsView`. A garden is a workspace — everything in the product
/// belongs to exactly one — so choosing one is a mode switch rather than a
/// push, and the whole root swaps to that garden's tab bar. That also means
/// "switch garden" is a way *back out*, not a `NavigationStack` pop through
/// screens the reader never wanted.
///
/// The chosen garden is deliberately not persisted across launches: doing so
/// would need a new stored preference, which is behavior rather than
/// presentation, and this pass changes presentation.
public struct RootView: View {
    private let composition: AppCompositionRoot

    @State private var selectedGarden: SelectedGarden?
    /// App foreground/background transitions — architecture/ios-application-
    /// design.md, section "8. Synchronization Integration": the
    /// synchronization engine "reacts to: ... App foreground/background
    /// transitions." (P5-IOS-03, Stage 5b.)
    ///
    /// The only real scene-phase/foreground trigger this codebase wires:
    /// connectivity-change (`NWPathMonitor`) and background-processing-
    /// opportunity (`BGTaskScheduler`) triggers remain a real, separate gap
    /// — confirmed by inspection, not assumed, that nothing in this
    /// codebase observes either today. Both would need genuinely new
    /// subsystems (a path monitor actor; `BGTaskSchedulerPermittedIdentifiers`
    /// in `Info.plist` plus a registered background task handler) well beyond
    /// "a small, clearly-scoped addition," so they are left as a documented
    /// gap for a future stage rather than built here.
    @Environment(\.scenePhase) private var scenePhase

    public init(composition: AppCompositionRoot) {
        self.composition = composition
    }

    public var body: some View {
        Group {
            if composition.sessionObserver.isSignedIn {
                signedInBody
            } else {
                SignInView(model: composition.makeSignInViewModel())
            }
        }
        .tint(Palette.accent)
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Self.triggerSyncOnForeground(composition: composition)
        }
    }

    @ViewBuilder
    private var signedInBody: some View {
        if let selectedGarden {
            GardenTabView(
                composition: composition,
                gardenId: selectedGarden.id,
                gardenName: selectedGarden.name,
                onSwitchGarden: { self.selectedGarden = nil }
            )
        } else {
            NavigationStack {
                GardensListView(model: composition.makeGardensListViewModel()) { gardenId, gardenName in
                    selectedGarden = SelectedGarden(id: gardenId, name: gardenName)
                }
            }
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

/// The garden the reader is currently inside.
///
/// Carries the name as well as the id so the tab bar's garden button can be
/// labelled immediately, without every tab waiting on its own fetch to learn
/// what the reader just tapped.
private struct SelectedGarden: Equatable {
    let id: String
    let name: String
}
