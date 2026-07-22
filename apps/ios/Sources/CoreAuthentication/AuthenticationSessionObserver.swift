import FirebaseAuth
import Observation

/// Whether a profile is currently signed in, kept current by Firebase's own
/// state-change listener rather than one snapshot read of `Auth.auth().
/// currentUser` — that snapshot is briefly `nil` on launch until Firebase
/// finishes restoring a persisted session, which would otherwise flash the
/// sign-in screen for an already-signed-in user.
///
/// Source: architecture/identity-and-authorization.md, section
/// "4. Native Authentication Flow".
@MainActor
@Observable
public final class AuthenticationSessionObserver {
    public private(set) var isSignedIn: Bool
    /// Scopes the per-profile local store; see `FeatureGardens.GardenDatabase`.
    public private(set) var currentFirebaseUid: String?

    // `deinit` is never actor-isolated, even on a @MainActor class, so a
    // plain @MainActor-isolated stored property cannot be read there. This
    // object lives for the app's session (constructed once by
    // AppCompositionRoot), so deinit in practice only runs at process
    // teardown, where correctness of this cleanup no longer matters — but
    // `nonisolated(unsafe)` is still the honest way to allow it, rather than
    // dropping the cleanup silently. Plain `nonisolated` does not compile
    // here: `@Observable` rewrites this into a computed property over a
    // mutable backing store, which only `nonisolated(unsafe)` permits.
    @ObservationIgnored
    private nonisolated(unsafe) var handle: AuthStateDidChangeListenerHandle?

    public init() {
        self.isSignedIn = Auth.auth().currentUser != nil
        self.currentFirebaseUid = Auth.auth().currentUser?.uid
        self.handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            self?.isSignedIn = user != nil
            self?.currentFirebaseUid = user?.uid
        }
    }

    deinit {
        if let handle {
            Auth.auth().removeStateDidChangeListener(handle)
        }
    }
}
