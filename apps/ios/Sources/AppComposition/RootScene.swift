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
    /// The only real scene-phase/foreground trigger this codebase wires,
    /// shared by two independent reactions on the same transition to
    /// `.active` (``triggerSyncOnForeground``, and
    /// ``triggerIncomingOwnershipTransfersRefresh`` added for P9A-OWNER-02):
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
        .tint(Palette.interaction)
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Self.triggerSyncOnForeground(composition: composition)
            Self.triggerIncomingOwnershipTransfersRefresh(composition: composition)
        }
        // Signing out leaves the garden chosen, and this state outlives the
        // sign-in screen: without this, the next sign-in — possibly as a
        // different profile — would land straight inside the previous
        // reader's garden. Clearing it here rather than at the sign-out call
        // site keeps the rule where the state lives, and makes it hold for
        // every way a session can end, including one Firebase ends itself.
        .onChange(of: composition.sessionObserver.isSignedIn) { _, isSignedIn in
            guard !isSignedIn else { return }
            selectedGarden = nil
        }
    }

    @ViewBuilder
    private var signedInBody: some View {
        Group {
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
                    .accountToolbar(composition: composition)
                }
            }
        }
        // The entry point a `verdery://invite?token=` deep link opens into
        // (P9A-IOS-01) — reachable from either state above: an invitation
        // may arrive while the reader is inside a garden or still choosing
        // one. A full-screen cover, not a sheet: accepting an invitation is
        // its own destination, not a modal refinement of whichever screen
        // happened to be showing when the link was tapped.
        .acceptInvitationCover(isPresented: isAcceptInvitationPresented) {
            if let token = composition.collaborationSessionState.pendingInvitationToken {
                AcceptInvitationView(
                    model: composition.makeAcceptInvitationViewModel(token: token),
                    onOpenGarden: { gardenId, gardenName in
                        composition.collaborationSessionState.clearPendingInvitation()
                        selectedGarden = SelectedGarden(id: gardenId, name: gardenName)
                    },
                    onClose: {
                        composition.collaborationSessionState.clearPendingInvitation()
                    }
                )
            }
        }
    }

    /// A deep link can arrive while signed out too (`AppCompositionRoot
    /// .handleIncomingURL` records the token regardless of session state);
    /// this only ever presents once `signedInBody` itself is on screen, so a
    /// token that arrived while signed out waits, untouched, for the reader
    /// to sign in — never lost, never presented to nobody.
    private var isAcceptInvitationPresented: Binding<Bool> {
        Binding(
            get: { composition.collaborationSessionState.pendingInvitationToken != nil },
            set: { isPresented in
                guard !isPresented else { return }
                composition.collaborationSessionState.clearPendingInvitation()
            }
        )
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

    /// Refreshes `collaborationSessionState.incomingTransfers` on the same
    /// foreground trigger as ``triggerSyncOnForeground`` — see
    /// `AppCompositionRoot.refreshIncomingOwnershipTransfers()`'s own doc
    /// comment for why this trigger and `GardenTabView`'s own shell-appear
    /// trigger together are this feature's chosen "check periodically or on
    /// a lifecycle event" pair (P9A-OWNER-02).
    @MainActor
    private static func triggerIncomingOwnershipTransfersRefresh(composition: AppCompositionRoot) {
        Task {
            await composition.refreshIncomingOwnershipTransfers()
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

/// A full-screen cover on iOS; `fullScreenCover` itself does not exist on
/// macOS, which this package also builds for headlessly (see
/// `Package.swift`'s own doc comment on why `swift build`/`swift test`
/// target macOS at all) — the same `#if os(iOS)` pattern
/// `FeatureMap/MapObjectPropertyView.swift` already uses for its own
/// iOS-only modifiers. The `#else` branch (a plain sheet) is dead in the
/// shipped iOS app; it exists only to keep the headless macOS build
/// compiling.
extension View {
    fileprivate func acceptInvitationCover<CoverContent: View>(
        isPresented: Binding<Bool>,
        @ViewBuilder content: @escaping () -> CoverContent
    ) -> some View {
        #if os(iOS)
        fullScreenCover(isPresented: isPresented, content: content)
        #else
        sheet(isPresented: isPresented, content: content)
        #endif
    }
}
