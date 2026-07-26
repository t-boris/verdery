import FirebaseAuth
import Foundation
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
    /// Who is signed in, as a Firebase-free value.
    ///
    /// Kept on this type rather than read from `Auth.auth().currentUser` at the
    /// point of use for the same reason `isSignedIn` is: a snapshot read is
    /// briefly `nil` on launch, and the account screen would then have nothing
    /// to show for an already-signed-in reader.
    public private(set) var currentAccount: AuthenticatedAccount?
    /// Scopes the per-profile local store; see `CorePersistence.LocalDatabase`.
    ///
    /// Derived rather than stored: one listener callback then cannot leave the
    /// uid describing a different profile from `currentAccount`.
    public var currentFirebaseUid: String? { currentAccount?.uid }

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
        self.currentAccount = Auth.auth().currentUser.map(Self.account(for:))
        self.handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            self?.isSignedIn = user != nil
            self?.currentAccount = user.map(Self.account(for:))
        }
    }

    /// The one place a `FirebaseAuth.User` becomes a value the rest of the
    /// application may hold.
    ///
    /// An empty display name or address is mapped to `nil`, not passed
    /// through: the SDK returns `""` for a field a provider did not supply,
    /// and a screen must be able to tell "absent" from "blank" so it can omit
    /// the row rather than render a labelled emptiness.
    private static func account(for user: User) -> AuthenticatedAccount {
        AuthenticatedAccount(
            uid: user.uid,
            displayName: user.displayName?.nonEmpty,
            emailAddress: user.email?.nonEmpty,
            isEmailVerified: user.isEmailVerified,
            providerIdentifiers: user.providerData.map(\.providerID)
        )
    }

    deinit {
        if let handle {
            Auth.auth().removeStateDidChangeListener(handle)
        }
    }
}

extension String {
    /// `nil` for a string that is empty once trimmed.
    fileprivate var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
